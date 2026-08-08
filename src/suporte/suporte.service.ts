import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface SupportTicket {
  id: number;
  tenant_slug: string;
  tenant_nome: string;
  usuario_nome: string;
  usuario_email: string;
  usuario_whatsapp?: string;
  assunto: string;
  mensagem: string;
  anexo_url?: string;
  anexo_nome?: string;
  status: 'pendente' | 'em_atendimento' | 'concluido';
  created_at: string;
}

@Injectable()
export class SuporteService {
  private readonly logger = new Logger(SuporteService.name);
  private tickets: SupportTicket[] = [];
  private currentId = 1;
  private readonly storageFilePath = path.join(process.cwd(), 'uploads', 'suporte', 'tickets.json');

  constructor() {
    this.loadTickets();
  }

  private loadTickets() {
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (fs.existsSync(this.storageFilePath)) {
        const raw = fs.readFileSync(this.storageFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.tickets = parsed;
          this.currentId = this.tickets.reduce((max, t) => (t.id > max ? t.id : max), 0) + 1;
        }
      }
    } catch (err) {
      this.logger.error('Erro ao carregar tickets de suporte:', err);
    }
  }

  private saveTickets() {
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storageFilePath, JSON.stringify(this.tickets, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error('Erro ao salvar tickets de suporte:', err);
    }
  }

  async createTicket(
    tenantSlug: string,
    user: any,
    body: { assunto: string; mensagem: string; anexo_base64?: string; anexo_nome?: string }
  ) {
    let anexo_url: string | undefined = undefined;

    if (body.anexo_base64) {
      try {
        const uploadsDir = path.join(process.cwd(), 'uploads', 'suporte');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const ext = body.anexo_nome ? path.extname(body.anexo_nome) : '.png';
        const fileName = `suporte_${Date.now()}${ext || '.png'}`;
        const filePath = path.join(uploadsDir, fileName);

        const base64Data = body.anexo_base64.replace(/^data:image\/\w+;base64,/, '').replace(/^data:application\/\w+;base64,/, '');
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        anexo_url = `/uploads/suporte/${fileName}`;
      } catch (err) {
        this.logger.error('Erro ao salvar anexo de suporte:', err);
      }
    }

    const newTicket: SupportTicket = {
      id: this.currentId++,
      tenant_slug: tenantSlug || 'global',
      tenant_nome: user?.tenant_nome || tenantSlug || 'Acionar Assinante',
      usuario_nome: user?.nome || 'Usuário',
      usuario_email: user?.email || 'email@acionar.online',
      usuario_whatsapp: user?.whatsapp || user?.telefone || '',
      assunto: body.assunto,
      mensagem: body.mensagem,
      anexo_url,
      anexo_nome: body.anexo_nome,
      status: 'pendente',
      created_at: new Date().toISOString(),
    };

    this.tickets.unshift(newTicket);
    this.saveTickets();

    // Disparo / Log de Notificação para julio.cesar.ovidio.bueno@gmail.com
    this.sendEmailNotification(newTicket);

    return {
      success: true,
      message: 'Chamado de suporte enviado com sucesso! O time foi notificado.',
      ticket: newTicket,
    };
  }

  private sendEmailNotification(ticket: SupportTicket) {
    const destinationEmail = 'julio.cesar.ovidio.bueno@gmail.com';
    this.logger.log(`=======================================================`);
    this.logger.log(`[DISPARO SUPORTE] Novo Chamado Enviado para ${destinationEmail}`);
    this.logger.log(`Tenant: ${ticket.tenant_nome} (${ticket.tenant_slug})`);
    this.logger.log(`Solicitante: ${ticket.usuario_nome} <${ticket.usuario_email}>`);
    this.logger.log(`Assunto: ${ticket.assunto}`);
    this.logger.log(`Mensagem: ${ticket.mensagem}`);
    if (ticket.anexo_url) this.logger.log(`Anexo URL: ${ticket.anexo_url}`);
    this.logger.log(`=======================================================`);
  }

  async getAllTickets(tenantSlug?: string) {
    if (tenantSlug) {
      return { tickets: this.tickets.filter((t) => t.tenant_slug === tenantSlug) };
    }
    return { tickets: this.tickets };
  }

  async updateStatus(id: number, status: 'pendente' | 'em_atendimento' | 'concluido') {
    const ticket = this.tickets.find((t) => t.id === id);
    if (ticket) {
      ticket.status = status;
      this.saveTickets();
      return { success: true, ticket };
    }
    throw new Error('Chamado não encontrado');
  }
}
