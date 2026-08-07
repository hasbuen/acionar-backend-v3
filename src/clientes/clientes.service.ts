import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';

@Injectable()
export class ClientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async findAll(tenantSlug: string, user?: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    const profId = user?.profissional_id;

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      let sql = 'SELECT * FROM clientes WHERE 1=1';
      const params: any[] = [];

      if (profId) {
        params.push(profId);
        sql += ` AND (profissional_id = $${params.length} OR profissional_id IS NULL)`;
      }

      sql += ' ORDER BY id DESC';

      const clientes: any = await this.prisma.$queryRawUnsafe(sql, ...params);
      return { clientes };
    });
  }


  async create(tenantSlug: string, user: any, dto: any) {
    const { nome, whatsapp, observacoes } = dto;
    if (!nome) throw new BadRequestException('Nome do cliente é obrigatório.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const profId = user?.profissional_id || null;

      if (whatsapp && profId) {
        const cleanWhatsapp = whatsapp.trim();
        const existing: any = await this.prisma.$queryRawUnsafe(
          'SELECT * FROM clientes WHERE whatsapp = $1 AND profissional_id = $2 LIMIT 1',
          cleanWhatsapp,
          profId,
        );

        if (existing && existing.length > 0) {
          const cliente = existing[0];
          if (cliente.nome !== nome) {
            const updated: any = await this.prisma.$queryRawUnsafe(
              'UPDATE clientes SET nome = $1 WHERE id = $2 RETURNING *',
              nome,
              cliente.id,
            );
            return { cliente: updated[0] };
          }
          return { cliente };
        }
      }

      const res: any = await this.prisma.$queryRawUnsafe(
        'INSERT INTO clientes (profissional_id, nome, whatsapp, observacoes) VALUES ($1, $2, $3, $4) RETURNING *',
        profId,
        nome,
        whatsapp || null,
        observacoes || null,
      );
      return { cliente: res[0] };
    });
  }


  async update(tenantSlug: string, id: number, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const { nome, whatsapp, observacoes } = dto;
      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE clientes
         SET nome = COALESCE($1, nome),
             whatsapp = COALESCE($2, whatsapp),
             observacoes = COALESCE($3, observacoes)
         WHERE id = $4 RETURNING *`,
        nome,
        whatsapp,
        observacoes,
        id,
      );

      if (!res || res.length === 0) throw new NotFoundException('Cliente não encontrado.');
      return { cliente: res[0] };
    });
  }

  async transferir(tenantSlug: string, id: number, profissionalDestinoId: number, user?: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        'UPDATE clientes SET profissional_id = $1 WHERE id = $2 RETURNING *',
        profissionalDestinoId,
        id,
      );
      if (!res || res.length === 0) throw new NotFoundException('Cliente não encontrado.');
      
      const cliente = res[0];
      let nomeRemetente = user?.nome;
      if (!nomeRemetente && user?.profissional_id) {
        const senderRes: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM profissionais WHERE id = $1', user.profissional_id);
        if (senderRes && senderRes.length > 0) nomeRemetente = senderRes[0].nome;
      }
      if (!nomeRemetente) nomeRemetente = 'Um colega';

      const titulo = 'Cliente Transferido';
      const mensagem = `O usuário ${nomeRemetente} transferiu o cadastro do cliente ${cliente.nome} para você.`;

      const insertedNotif: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO notificacoes (profissional_id, titulo, mensagem)
         VALUES ($1, $2, $3)
         RETURNING id, titulo, mensagem, lida, created_at`,
        profissionalDestinoId,
        titulo,
        mensagem
      );

      if (insertedNotif && insertedNotif.length > 0) {
        this.notificationsGateway.emitToUser(
          profissionalDestinoId,
          'notifications-changed',
          { ...insertedNotif[0], profissional_id: profissionalDestinoId }
        );
      }

      return { cliente, message: 'Cadastro do cliente transferido com sucesso.' };
    });
  }

  async remove(tenantSlug: string, user: any, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const clientRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT profissional_id FROM clientes WHERE id = $1',
        id,
      );
      if (!clientRes || clientRes.length === 0) throw new NotFoundException('Cliente não encontrado.');
      if (clientRes[0].profissional_id && clientRes[0].profissional_id !== user.profissional_id) {
        throw new ForbiddenException('Você só pode excluir clientes de sua propriedade.');
      }

      const agRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT id FROM agendamentos WHERE cliente_id = $1 ORDER BY id ASC',
        id,
      );
      if (agRes && agRes.length > 0) {
        const listIds = agRes.map((a: any) => `#${a.id}`).join(', ');
        throw new BadRequestException(`Cliente possui os agendamentos ${listIds} registrados.`);
      }

      const res: any = await this.prisma.$queryRawUnsafe(
        'DELETE FROM clientes WHERE id = $1 RETURNING *',
        id,
      );

      return { message: 'Cliente removido com sucesso.' };
    });
  }
}




