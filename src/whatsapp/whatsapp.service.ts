import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiUrl = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
  private readonly apiKey = process.env.EVOLUTION_API_KEY || 'acionar_token_v3_secure_evolution';

  constructor(private readonly prisma: PrismaService) {}

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'apikey': this.apiKey,
    };
  }

  async getStatus(tenantSlug: string) {
    const instanceName = `tenant_${tenantSlug}`;
    try {
      const response = await fetch(`${this.apiUrl}/instance/connectionState/${instanceName}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return { connected: false, state: 'close' };
      }

      const data = await response.json();
      const state = data?.instance?.state || 'close';
      return {
        connected: state === 'open',
        state,
      };
    } catch (error) {
      this.logger.error(`Erro ao obter status do WhatsApp para ${instanceName}:`, error);
      return { connected: false, state: 'close', error: error.message };
    }
  }

  async connect(tenantSlug: string) {
    const instanceName = `tenant_${tenantSlug}`;
    try {
      // 1. Tentar criar a instância (caso não exista)
      const createResponse = await fetch(`${this.apiUrl}/instance/create`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: 'WHATSAPP-BAILEYS',
        }),
      });

      const createData = await createResponse.json();

      const createQr = createData?.qrcode?.base64 || createData?.base64;
      if (createQr) {
        return {
          qrcode: createQr,
          state: 'connecting',
        };
      }

      // 2. Se a instância já existe mas está desconectada, buscar o QR Code de conexão
      const connectResponse = await fetch(`${this.apiUrl}/instance/connect/${instanceName}`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      const connectData = await connectResponse.json();
      const connectQr = connectData?.qrcode?.base64 || connectData?.base64;
      if (connectQr) {
        return {
          qrcode: connectQr,
          state: 'connecting',
        };
      }

      // Se já estiver conectado
      const status = await this.getStatus(tenantSlug);
      return {
        qrcode: null,
        state: status.state,
        connected: status.connected,
      };
    } catch (error) {
      this.logger.error(`Erro ao conectar WhatsApp para ${instanceName}:`, error);
      throw new BadRequestException(`Erro ao conectar ao WhatsApp: ${error.message}`);
    }
  }

  async disconnect(tenantSlug: string) {
    const instanceName = `tenant_${tenantSlug}`;
    try {
      // Realiza o logout
      await fetch(`${this.apiUrl}/instance/logout/${instanceName}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      // Deleta a instância
      await fetch(`${this.apiUrl}/instance/delete/${instanceName}`, {
        method: 'DELETE',
        headers: this.getHeaders(),
      });

      // Atualiza o estado no banco de dados do tenant
      await this.prisma.ensureTenantSchema(tenantSlug);
      await this.prisma.runInTenantSchema(tenantSlug, async () => {
        const settings = { connected: false, session_name: instanceName, updated_at: new Date() };
        await this.prisma.$executeRawUnsafe(
          'INSERT INTO configuracoes (chave, valor, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()',
          'whatsapp',
          JSON.stringify(settings),
        );
      });

      return { success: true, message: 'WhatsApp desconectado com sucesso.' };
    } catch (error) {
      this.logger.error(`Erro ao desconectar WhatsApp para ${instanceName}:`, error);
      throw new BadRequestException(`Erro ao desconectar WhatsApp: ${error.message}`);
    }
  }

  async sendTextMessage(tenantSlug: string, phone: string, text: string) {
    const instanceName = `tenant_${tenantSlug}`;
    // Limpar o número do telefone (deve conter apenas dígitos, ex: 5511999999999)
    const cleanPhone = String(phone).replace(/\D/g, '');
    
    // Adicionar código do país se não tiver (padrão Brasil: 55)
    const phoneWithCountry = cleanPhone.length <= 11 ? `55${cleanPhone}` : cleanPhone;

    try {
      const response = await fetch(`${this.apiUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          number: phoneWithCountry,
          text,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        this.logger.error(`Erro ao enviar mensagem de WhatsApp (${response.status}):`, errorData);
        return { success: false, status: response.status, error: errorData };
      }

      const data = await response.json();
      return { success: true, message: 'Mensagem enviada com sucesso.', data };
    } catch (error) {
      this.logger.error(`Erro ao disparar mensagem para ${cleanPhone} via ${instanceName}:`, error);
      return { success: false, error: error.message };
    }
  }
}
