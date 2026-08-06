import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}


  async getTenantPublicInfo(slug: string) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: cleanSlug },
      select: {
        slug: true,
        nome_empresa: true,
        foto_url: true,
        cor_primaria: true,
        cor_destaque: true,
        cor_fundo: true,
        agenda_publica_ativa: true,
      },
    });

    if (!tenant) throw new NotFoundException('Establishment not found.');
    return { tenant };
  }

  async getPublicServices(slug: string) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    await this.prisma.ensureTenantSchema(cleanSlug);

    return this.prisma.runInTenantSchema(cleanSlug, async () => {
      const servicos: any = await this.prisma.$queryRawUnsafe('SELECT * FROM servicos WHERE ativo = true ORDER BY nome ASC');
      const subservicos: any = await this.prisma.$queryRawUnsafe('SELECT * FROM subservicos WHERE ativo = true ORDER BY nome ASC');

      const result = servicos.map(s => ({
        ...s,
        subservicos: subservicos.filter(sub => sub.servico_id === s.id),
      }));

      return { servicos: result };
    });
  }

  async getPublicProfessionals(slug: string) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    await this.prisma.ensureTenantSchema(cleanSlug);

    return this.prisma.runInTenantSchema(cleanSlug, async () => {
      const profissionais: any = await this.prisma.$queryRawUnsafe('SELECT id, nome, foto_url, cargo FROM profissionais WHERE ativo = true ORDER BY nome ASC');
      return { profissionais };
    });
  }

  async createPublicAppointment(slug: string, dto: any) {
    const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
    if (!tenant) throw new NotFoundException('Tenant not found.');
    if (!tenant.agenda_publica_ativa) {
      throw new ForbiddenException('Public online scheduling is currently closed for this establishment.');
    }

    await this.prisma.ensureTenantSchema(cleanSlug);

    const {
      cliente_nome,
      cliente_whatsapp,
      cliente_email,
      profissional_id,
      servico_id,
      subservico_id,
      data_hora,
      observacao,
      tipo_atendimento,
      endereco_externo,
    } = dto;

    if (!cliente_nome || !cliente_whatsapp || !servico_id || !data_hora) {
      throw new BadRequestException('Name, WhatsApp, Service, and Date/Time are required.');
    }

    return this.prisma.runInTenantSchema(cleanSlug, async () => {
      // 1. Find or create customer
      const existing: any = await this.prisma.$queryRawUnsafe(
        'SELECT id FROM clientes WHERE whatsapp = $1 OR (email IS NOT NULL AND email = $2) LIMIT 1',
        cliente_whatsapp, cliente_email || ''
      );

      let clienteId: number;
      if (existing && existing.length > 0) {
        clienteId = existing[0].id;
      } else {
        const newC: any = await this.prisma.$queryRawUnsafe(
          'INSERT INTO clientes (nome, whatsapp, email) VALUES ($1, $2, $3) RETURNING id',
          cliente_nome, cliente_whatsapp, cliente_email || null
        );
        clienteId = newC[0].id;
      }

      // 2. Fetch service
      const servRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT preco, duracao_minutos FROM servicos WHERE id = $1',
        servico_id
      );
      if (!servRes || servRes.length === 0) throw new NotFoundException('Service not found.');

      let valorTotal = parseFloat(servRes[0].preco || 0);
      let duracaoTotal = parseInt(servRes[0].duracao_minutos || 60, 10);

      if (subservico_id) {
        const subRes: any = await this.prisma.$queryRawUnsafe(
          'SELECT preco_adicional, duracao_adicional_minutos FROM subservicos WHERE id = $1',
          subservico_id
        );
        if (subRes && subRes.length > 0) {
          valorTotal += parseFloat(subRes[0].preco_adicional || 0);
          duracaoTotal += parseInt(subRes[0].duracao_adicional_minutos || 0, 10);
        }
      }

      // 3. Create appointment with timestamptz cast
      const apptRes: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO agendamentos (
          cliente_id, profissional_id, servico_id, subservico_id, data_hora,
          duracao_total_minutos, valor_total, status, observacao, tipo_atendimento, endereco_externo
        ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6, $7, 'aguardando_confirmacao', $8, $9, $10)
        RETURNING *`,
        clienteId,
        profissional_id || null,
        servico_id,
        subservico_id || null,
        data_hora,
        duracaoTotal,
        valorTotal,
        observacao || 'Agendado via Agenda Pública',
        tipo_atendimento || 'salao',
        endereco_externo || null
      );

      try {
        await this.notificationsService.sendAppointmentPush(cleanSlug, apptRes[0].id);
      } catch (err) {
        console.error('Failed to trigger public appointment push notification:', err);
      }

      return {
        message: 'Appointment requested successfully.',
        agendamento: apptRes[0],
      };
    });
  }
}

