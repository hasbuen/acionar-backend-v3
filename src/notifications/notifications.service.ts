import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as webpush from 'web-push';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {
    if (process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
      );
    }
  }

  async getPublicKey() {
    return { publicKey: process.env.VAPID_PUBLIC_KEY || '' };
  }

  async subscribe(tenantSlug: string, user: any, dto: any) {
    const { endpoint, p256dh, auth, user_agent, plataforma } = dto;
    if (!endpoint) throw new BadRequestException('Endpoint is required.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO push_subscriptions (endpoint, p256dh, auth, profissional_id, user_agent, plataforma, ativo, atualizado_em)
         VALUES ($1, $2, $3, $4, $5, $6, true, NOW())
         ON CONFLICT (endpoint) 
         DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, profissional_id = EXCLUDED.profissional_id, ativo = true, atualizado_em = NOW()`,
        endpoint,
        p256dh,
        auth,
        user.profissional_id,
        user_agent || null,
        plataforma || null
      );
      return { message: 'Subscribed to push notifications.' };
    });
  }

  async unsubscribe(tenantSlug: string, dto: any) {
    const { endpoint } = dto;
    if (!endpoint) throw new BadRequestException('Endpoint is required.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      await this.prisma.$executeRawUnsafe(
        'UPDATE push_subscriptions SET ativo = false, atualizado_em = NOW() WHERE endpoint = $1',
        endpoint
      );
      return { message: 'Unsubscribed from push notifications.' };
    });
  }

  async sendAppointmentPush(tenantSlug: string, appointmentId: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const apptRows: any = await this.prisma.$queryRawUnsafe(
        `SELECT a.*, c.nome as cliente_nome, c.whatsapp as cliente_whatsapp, s.nome as servico_nome
         FROM agendamentos a
         LEFT JOIN clientes c ON a.cliente_id = c.id
         LEFT JOIN servicos s ON a.servico_id = s.id
         WHERE a.id = $1`,
        appointmentId
      );
      if (!apptRows || apptRows.length === 0) return;
      const appointment = apptRows[0];

      let nomeCliente = appointment.cliente_nome;
      let whatsappCliente = appointment.cliente_whatsapp;
      if (appointment.observacao) {
        try {
          const obs = typeof appointment.observacao === 'object' ? appointment.observacao : JSON.parse(appointment.observacao);
          if (obs && obs.temp_cliente_nome) {
            nomeCliente = obs.temp_cliente_nome;
          }
          if (obs && obs.temp_cliente_whatsapp) {
            whatsappCliente = obs.temp_cliente_whatsapp;
          }
        } catch (e) {}
      }

      const cleanPhone = whatsappCliente ? String(whatsappCliente).replace(/\D/g, '') : '';
      const phoneFormatted = cleanPhone ? (cleanPhone.length >= 10 ? `(${cleanPhone.slice(-11, -8)}) ${cleanPhone.slice(-8, -4)}-${cleanPhone.slice(-4)}` : cleanPhone) : 'Não informado';
      const dateFormatted = new Date(appointment.data_hora).toLocaleDateString('pt-BR');
      const timeFormatted = new Date(appointment.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const dataHoraFormatted = `${dateFormatted} às ${timeFormatted}`;

      let subscriptions: any[] = [];
      if (appointment.profissional_id) {
        subscriptions = await this.prisma.$queryRawUnsafe(
          'SELECT * FROM push_subscriptions WHERE profissional_id = $1 AND ativo = true',
          appointment.profissional_id
        );
      } else {
        subscriptions = await this.prisma.$queryRawUnsafe(
          'SELECT * FROM push_subscriptions WHERE ativo = true'
        );
      }

      if (subscriptions.length === 0) return;

      const payload = JSON.stringify({
        title: `Novo agendamento: ${nomeCliente || 'Cliente'}`,
        body: `Serviço: ${appointment.servico_nome || 'Serviço'}\nData: ${dataHoraFormatted}\n📱 WhatsApp: ${phoneFormatted}`,
        url: '/agenda',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: {
          url: '/agenda',
          tenantSlug,
          agendamentoId: appointment.id,
          clienteNome: nomeCliente || 'Cliente',
          servicoNome: appointment.servico_nome || 'Serviço',
          whatsapp: cleanPhone ? (cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`) : '',
          dataHoraFormatted,
          confirmUrl: `/api/public/tenant/${tenantSlug}/agendamentos/${appointment.id}/confirmar-rapido`
        },
        actions: [
          { action: 'confirm_whatsapp', title: '✅ Confirmar & WhatsApp' },
          { action: 'open_agenda', title: '📅 Ver na Agenda' }
        ]
      });

      for (const sub of subscriptions) {
        if (!sub.endpoint || !sub.p256dh || !sub.auth) continue;
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          }, payload);
        } catch (error: any) {
          console.error('Failed to send web push notification:', error);
          const statusCode = error.response?.statusCode || 0;
          if ([401, 403, 404, 410].includes(statusCode)) {
            await this.prisma.$executeRawUnsafe(
              'UPDATE push_subscriptions SET ativo = false WHERE id = $1',
              sub.id
            );
          }
        }
      }
    });
  }

  async findAll(tenantSlug: string, user: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const notifications: any = await this.prisma.$queryRawUnsafe(
        'SELECT id, titulo, mensagem, lida, created_at FROM notificacoes WHERE profissional_id = $1 ORDER BY created_at DESC LIMIT 50',
        user.profissional_id,
      );
      return { notifications };
    });
  }

  async markAsRead(tenantSlug: string, id: number, user: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const result: any = await this.prisma.$queryRawUnsafe(
        'UPDATE notificacoes SET lida = true WHERE id = $1 AND profissional_id = $2 RETURNING *',
        id,
        user.profissional_id,
      );
      return { notification: result[0] };
    });
  }

  async clearAll(tenantSlug: string, user: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      await this.prisma.$queryRawUnsafe(
        'DELETE FROM notificacoes WHERE profissional_id = $1',
        user.profissional_id,
      );
      return { message: 'Notifications cleared.' };
    });
  }
}
