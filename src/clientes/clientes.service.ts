import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const clientes: any = await this.prisma.$queryRawUnsafe('SELECT * FROM clientes ORDER BY nome ASC');
      return { clientes };
    });
  }

  async create(tenantSlug: string, dto: any) {
    const { nome, whatsapp, email, observacoes } = dto;
    if (!nome) throw new BadRequestException('Client name is required.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        'INSERT INTO clientes (nome, whatsapp, email, observacoes) VALUES ($1, $2, $3, $4) RETURNING *',
        nome, whatsapp || null, email || null, observacoes || null
      );
      return { cliente: res[0] };
    });
  }

  async update(tenantSlug: string, id: number, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const { nome, whatsapp, email, observacoes } = dto;
      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE clientes
         SET nome = COALESCE($1, nome),
             whatsapp = COALESCE($2, whatsapp),
             email = COALESCE($3, email),
             observacoes = COALESCE($4, observacoes)
         WHERE id = $5 RETURNING *`,
        nome, whatsapp, email, observacoes, id
      );

      if (!res || res.length === 0) throw new NotFoundException('Client not found.');
      return { cliente: res[0] };
    });
  }
}
