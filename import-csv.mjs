import fs from 'fs';
import path from 'path';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Client } = pg;

const connectionString = 'postgresql://acionar:Bu1v742G36K850@localhost:5439/tenant_patriciabeato';
const csvDirectory = 'D:/startup/dados-banco-csv';

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map(val => val.replace(/^"|"$/g, '').replace(/""/g, '"'));
}

function parseCsvContent(content) {
  const lines = [];
  let currentLine = '';
  let inQuotes = false;
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    }
    
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (currentLine.trim()) {
        lines.push(parseCsvLine(currentLine));
      }
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) {
    lines.push(parseCsvLine(currentLine));
  }
  
  const headers = lines[0];
  const data = lines.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] || '';
    });
    return obj;
  });
  return data;
}

async function runMigration() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log('[MIGRATION] Connected to PostgreSQL tenant database.');

  try {
    // 1. Limpar tabelas locais
    console.log('[MIGRATION] Truncating tables in cascade...');
    await client.query('TRUNCATE TABLE subservico_produtos, servico_produtos, configuracoes, estoque_movimentacoes, estoque_produtos, fluxo_caixa, agendamentos, clientes, subservicos, servicos, profissionais RESTART IDENTITY CASCADE;');

    const profissionalMap = new Map();
    const servicoMap = new Map();
    const subservicoMap = new Map();
    const clienteMap = new Map();
    const produtoMap = new Map();

    // --- PROFISSIONAIS ---
    console.log('[MIGRATION] Migrating profissionais...');
    const profCsv = fs.readFileSync(path.join(csvDirectory, 'profissionais.csv'), 'utf-8');
    const profs = parseCsvContent(profCsv);

    for (const p of profs) {
      const email = p.email.toLowerCase().trim();
      let senhaHash = p.senha_hash;
      if (senhaHash && !senhaHash.startsWith('$2a$') && !senhaHash.startsWith('$2b$')) {
        const salt = await bcrypt.genSalt(10);
        senhaHash = await bcrypt.hash(senhaHash, salt);
      }

      const res = await client.query(
        `INSERT INTO profissionais (nome, email, telefone, cargo, foto_url, ativo, senha_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          p.nome,
          email,
          p.telefone || null,
          p.cargo || 'auxiliar',
          p.foto_url || null,
          p.ativo === 't',
          senhaHash,
          p.criado_em || new Date()
        ]
      );
      profissionalMap.set(p.id, res.rows[0].id);
    }

    // --- SERVICOS ---
    console.log('[MIGRATION] Migrating servicos...');
    const servCsv = fs.readFileSync(path.join(csvDirectory, 'servicos.csv'), 'utf-8');
    const servs = parseCsvContent(servCsv);

    for (const s of servs) {
      const res = await client.query(
        `INSERT INTO servicos (nome, descricao, duracao_minutos, preco, ativo, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          s.nome,
          s.descricao || null,
          parseInt(s.duracao_minutos, 10) || 60,
          parseFloat(s.preco) || 0.0,
          s.ativo === 't',
          s.criado_em || new Date()
        ]
      );
      servicoMap.set(s.id, res.rows[0].id);
    }

    // --- SUBSERVICOS ---
    console.log('[MIGRATION] Migrating subservicos...');
    const subCsv = fs.readFileSync(path.join(csvDirectory, 'subservicos.csv'), 'utf-8');
    const subs = parseCsvContent(subCsv);

    for (const sub of subs) {
      const mappedServId = servicoMap.get(sub.servico_id);
      if (!mappedServId) continue;

      const res = await client.query(
        `INSERT INTO subservicos (servico_id, nome, duracao_adicional_minutos, preco_adicional, ativo, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          mappedServId,
          sub.nome,
          parseInt(sub.duracao_adicional_minutos, 10) || 0,
          parseFloat(sub.preco_adicional) || 0.0,
          sub.ativo === 't',
          sub.criado_em || new Date()
        ]
      );
      subservicoMap.set(sub.id, res.rows[0].id);
    }

    // --- CLIENTES ---
    console.log('[MIGRATION] Migrating clientes...');
    const clientCsv = fs.readFileSync(path.join(csvDirectory, 'clientes.csv'), 'utf-8');
    const clients = parseCsvContent(clientCsv);

    for (const c of clients) {
      const res = await client.query(
        `INSERT INTO clientes (nome, whatsapp, email, observacoes, created_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          c.nome,
          c.whatsapp || null,
          null,
          null,
          c.criado_em || new Date()
        ]
      );
      clienteMap.set(c.id, res.rows[0].id);
    }

    // --- AGENDAMENTOS ---
    console.log('[MIGRATION] Migrating agendamentos...');
    const agendCsv = fs.readFileSync(path.join(csvDirectory, 'agendamentos.csv'), 'utf-8');
    const agends = parseCsvContent(agendCsv);

    const agendMap = new Map();

    for (const a of agends) {
      const mappedClientId = clienteMap.get(a.cliente_id) || null;
      const mappedProfId = profissionalMap.get(a.profissional_id) || null;
      const mappedServId = servicoMap.get(a.servico_id) || null;
      const mappedSubservId = subservicoMap.get(a.subservico_id) || null;

      const tInicio = new Date(a.data_hora_inicio);
      const tFim = a.data_hora_fim ? new Date(a.data_hora_fim) : null;
      let duracao = 60;
      if (tFim) {
        duracao = Math.round((tFim.getTime() - tInicio.getTime()) / 60000);
      }

      let precoServico = 0.0;
      if (mappedServId) {
        const sObj = servs.find(s => s.id === a.servico_id);
        if (sObj) precoServico = parseFloat(sObj.preco) || 0.0;
      }
      if (mappedSubservId) {
        const subObj = subs.find(sub => sub.id === a.subservico_id);
        if (subObj) precoServico += parseFloat(subObj.preco_adicional) || 0.0;
      }

      const res = await client.query(
        `INSERT INTO agendamentos (cliente_id, profissional_id, servico_id, subservico_id, data_hora, duracao_total_minutos, valor_total, status, observacao, tipo_atendimento, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          mappedClientId,
          mappedProfId,
          mappedServId,
          mappedSubservId,
          a.data_hora_inicio,
          duracao,
          precoServico,
          a.status || 'agendado',
          a.observacoes || null,
          a.tipo_atendimento || 'salao',
          a.criado_em || new Date()
        ]
      );
      agendMap.set(a.id, res.rows[0].id);
    }

    // --- FLUXO CAIXA ---
    console.log('[MIGRATION] Migrating fluxo de caixa...');
    const caixaCsv = fs.readFileSync(path.join(csvDirectory, 'fluxo_caixa.csv'), 'utf-8');
    const lancamentos = parseCsvContent(caixaCsv);

    for (const l of lancamentos) {
      const mappedAgendId = agendMap.get(l.agendamento_id) || null;
      const mappedProfId = profissionalMap.get(l.profissional_id) || null;

      await client.query(
        `INSERT INTO fluxo_caixa (agendamento_id, profissional_id, tipo, descricao, valor, status, forma_pagamento, data_movimento, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          mappedAgendId,
          mappedProfId,
          l.tipo || 'entrada',
          l.descricao || 'Lançamento',
          parseFloat(l.valor) || 0.0,
          l.status_pagamento || l.status || 'pago',
          l.forma_pagamento || 'pix',
          l.data_movimento ? l.data_movimento.slice(0, 10) : new Date().toISOString().slice(0, 10),
          l.criado_em || new Date()
        ]
      );
    }

    // --- ESTOQUE PRODUTOS ---
    console.log('[MIGRATION] Migrating estoque produtos...');
    const prodCsv = fs.readFileSync(path.join(csvDirectory, 'estoque_produtos.csv'), 'utf-8');
    const prods = parseCsvContent(prodCsv);

    for (const pr of prods) {
      const mappedProfId = profissionalMap.get(pr.profissional_id) || null;
      const res = await client.query(
        `INSERT INTO estoque_produtos (profissional_id, nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          mappedProfId,
          pr.nome,
          pr.tipo || 'consumo',
          parseInt(pr.quantidade, 10) || 0,
          parseInt(pr.estoque_minimo, 10) || 1,
          parseFloat(pr.custo_unitario) || 0.0,
          pr.imagem_url || null,
          pr.criado_em || new Date()
        ]
      );
      produtoMap.set(pr.id, res.rows[0].id);
    }

    // --- ESTOQUE MOVIMENTACOES ---
    console.log('[MIGRATION] Migrating estoque movimentacoes...');
    const movCsv = fs.readFileSync(path.join(csvDirectory, 'estoque_movimentacoes.csv'), 'utf-8');
    const movs = parseCsvContent(movCsv);

    for (const m of movs) {
      const mappedProdId = produtoMap.get(m.produto_id) || null;
      const mappedProfId = profissionalMap.get(m.profissional_id) || null;
      if (!mappedProdId) continue;

      await client.query(
        `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          mappedProdId,
          mappedProfId,
          m.tipo || 'entrada',
          parseInt(m.quantidade, 10) || 1,
          m.motivo || null,
          m.criado_em || new Date()
        ]
      );
    }

    // --- CONFIGURACOES ---
    console.log('[MIGRATION] Migrating configuracoes...');
    const configCsv = fs.readFileSync(path.join(csvDirectory, 'configuracoes.csv'), 'utf-8');
    const configs = parseCsvContent(configCsv);

    for (const c of configs) {
      // O campo valor pode vir em formato de string JSON
      let valJson = c.valor;
      try {
        // Garantir que seja um JSON válido antes de salvar
        JSON.parse(valJson);
      } catch (err) {
        valJson = JSON.stringify({ raw: valJson });
      }

      await client.query(
        `INSERT INTO configuracoes (chave, valor, updated_at)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()`,
        [
          c.chave,
          valJson,
          c.atualizado_em || c.criado_em || new Date()
        ]
      );
    }

    // --- SERVICO PRODUTOS ---
    console.log('[MIGRATION] Migrating servico_produtos...');
    const spCsv = fs.readFileSync(path.join(csvDirectory, 'servico_produtos.csv'), 'utf-8');
    const sps = parseCsvContent(spCsv);

    for (const sp of sps) {
      const mappedServId = servicoMap.get(sp.servico_id);
      const mappedProdId = produtoMap.get(sp.produto_id);
      if (!mappedServId || !mappedProdId) continue;

      await client.query(
        `INSERT INTO servico_produtos (servico_id, produto_id, quantidade_usada)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [
          mappedServId,
          mappedProdId,
          parseFloat(sp.quantidade_usada) || 1.00
        ]
      );
    }

    // --- SUBSERVICO PRODUTOS ---
    console.log('[MIGRATION] Migrating subservico_produtos...');
    const sspCsv = fs.readFileSync(path.join(csvDirectory, 'subservico_produtos.csv'), 'utf-8');
    const ssps = parseCsvContent(sspCsv);

    for (const ssp of ssps) {
      const mappedSubId = subservicoMap.get(ssp.subservico_id);
      const mappedProdId = produtoMap.get(ssp.produto_id);
      if (!mappedSubId || !mappedProdId) continue;

      await client.query(
        `INSERT INTO subservico_produtos (subservico_id, produto_id, quantidade_usada)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [
          mappedSubId,
          mappedProdId,
          parseFloat(ssp.quantidade_usada) || 1.00
        ]
      );
    }

    console.log('[MIGRATION] SUCCESS! All data migrated to database tenant_patriciabeato.');

  } catch (error) {
    console.error('[MIGRATION ERROR]', error);
  } finally {
    await client.end();
  }
}

runMigration();
