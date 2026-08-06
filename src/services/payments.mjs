import fetch from 'node-fetch';

/**
 * Calculate CRC16 CCITT
 */
export function crc16Ccitt(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Generate Pix EMV Payload (Static Pix)
 */
export function generatePixEmvPayload({ chavePix, nome = 'ACIONAR', cidade = 'SAO PAULO', valor = 0, txid = '***' }) {
  let cleanChave = String(chavePix || '').trim();
  if (!cleanChave) return null;

  // Celular format: add +55 if it's 11 digits
  const digitsOnly = cleanChave.replace(/\D/g, '');
  if (digitsOnly.length === 11 && !cleanChave.startsWith('+') && !cleanChave.includes('@')) {
    cleanChave = `+55${digitsOnly}`;
  }

  const cleanNome = String(nome || 'ACIONAR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .slice(0, 25);
  
  const cleanCidade = String(cidade || 'SAO PAULO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .slice(0, 15);
  
  const cleanValor = Number(valor || 0).toFixed(2);
  const cleanTxid = String(txid || '***').replace(/[^a-zA-Z0-9]/g, '').slice(0, 25) || '***';

  const gui = '0014BR.GOV.BCB.PIX';
  const keyTag = `01${String(cleanChave.length).padStart(2, '0')}${cleanChave}`;
  const merchantAccount = `${gui}${keyTag}`;

  const txidTag = `05${String(cleanTxid.length).padStart(2, '0')}${cleanTxid}`;

  let payload = '000201';
  payload += `26${String(merchantAccount.length).padStart(2, '0')}${merchantAccount}`;
  payload += '52040000';
  payload += '5303986';
  payload += `54${String(cleanValor.length).padStart(2, '0')}${cleanValor}`;
  payload += '5802BR';
  payload += `59${String(cleanNome.length).padStart(2, '0')}${cleanNome}`;
  payload += `60${String(cleanCidade.length).padStart(2, '0')}${cleanCidade}`;
  payload += `62${String(txidTag.length).padStart(2, '0')}${txidTag}`;
  payload += '6304';

  const crc = crc16Ccitt(payload);
  return payload + crc;
}

/**
 * Clean Non-digits
 */
export function cleanTaxId(val = '') {
  return String(val || '').replace(/\D/g, '');
}

/**
 * Generate fallback valid CPF
 */
function generateValidCpf() {
  const n = [7, 1, 0, 8, 3, 2, 4, 9, 5];
  let d1 = n.reduce((total, number, index) => total + (number * (10 - index)), 0) % 11;
  d1 = d1 < 2 ? 0 : 11 - d1;
  let d2 = [...n, d1].reduce((total, number, index) => total + (number * (11 - index)), 0) % 11;
  d2 = d2 < 2 ? 0 : 11 - d2;
  return [...n, d1, d2].join('');
}

function generateFallbackCpf(seed = '') {
  const clean = cleanTaxId(seed);
  if (clean.length === 11) return clean;
  return generateValidCpf();
}

/**
 * Dynamic Asaas API URL
 */
function asaasApiUrl(settings) {
  if (settings.asaas_environment === 'production') {
    return 'https://www.asaas.com/api/v3';
  }
  return 'https://sandbox.asaas.com/api/v3';
}

/**
 * Fetch from Asaas
 */
export async function asaasFetch(path, options = {}, settings = {}) {
  const apiKey = String(settings.asaas_api_key || '').trim();
  if (!apiKey) {
    throw new Error('Asaas API key is not configured.');
  }

  const baseUrl = asaasApiUrl(settings);
  const url = `${baseUrl}${path}`;

  const headers = {
    'Content-Type': 'application/json',
    access_token: apiKey,
    ...(options.headers || {})
  };

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data?.errors?.[0]?.description || data?.message || `Asaas API responded with status ${response.status}`;
    const err = new Error(errorMsg);
    err.statusCode = response.status;
    err.code = data?.errors?.[0]?.code || 'ASAAS_API_ERROR';
    throw err;
  }

  return data;
}

/**
 * Create or get Asaas customer
 */
export async function getOrCreateAsaasCustomer(customerData, settings) {
  const rawCpf = cleanTaxId(customerData.cpfCnpj);
  const cpfCnpj = rawCpf.length >= 11 ? rawCpf : generateFallbackCpf(customerData.phone || customerData.email || customerData.name);

  if (cpfCnpj) {
    const search = await asaasFetch(`/customers?cpfCnpj=${cpfCnpj}`, { method: 'GET' }, settings).catch(() => null);
    if (search?.data && search.data.length > 0) {
      return search.data[0];
    }
  }

  return asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: customerData.name || 'Cliente Acionar',
      email: customerData.email || undefined,
      cpfCnpj: cpfCnpj,
      phone: cleanTaxId(customerData.phone) || undefined,
      notificationDisabled: true
    })
  }, settings);
}

/**
 * Create Asaas Payment
 */
export async function createAsaasPayment({ customerId, value, description, externalReference, billingType = 'PIX' }, settings) {
  const today = new Date();
  today.setDate(today.getDate() + 3);
  const dueDate = today.toISOString().split('T')[0];

  const body = {
    customer: customerId,
    billingType: billingType || 'PIX',
    value: Number(value),
    dueDate,
    description: description || 'Serviço Agendado - Acionar',
    externalReference: externalReference ? String(externalReference) : undefined
  };

  return asaasFetch('/payments', {
    method: 'POST',
    body: JSON.stringify(body)
  }, settings);
}

/**
 * Get Asaas Pix QR Code details
 */
export async function getAsaasPixQrCode(paymentId, settings) {
  return asaasFetch(`/payments/${paymentId}/pixQrCode`, { method: 'GET' }, settings);
}
