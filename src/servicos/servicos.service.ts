import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServicosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const servicos: any = await this.prisma.$queryRawUnsafe('SELECT * FROM servicos ORDER BY nome ASC');
      const subservicos: any = await this.prisma.$queryRawUnsafe('SELECT * FROM subservicos ORDER BY nome ASC');

      const result = servicos.map(s => ({
        ...s,
        subservicos: subservicos.filter(sub => sub.servico_id === s.id),
      }));

      return { servicos: result };
    });
  }

  async create(tenantSlug: string, dto: any) {
    const { nome, descricao, duracao_minutos, preco, ativo } = dto;
    if (!nome || preco === undefined) throw new BadRequestException('Name and Price are required.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO servicos (nome, descricao, duracao_minutos, preco, ativo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        nome, descricao || null, duracao_minutos || 60, preco, ativo !== undefined ? ativo : true
      );
      return { servico: res[0] };
    });
  }

  async update(tenantSlug: string, id: number, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const { nome, descricao, duracao_minutos, preco, ativo } = dto;
      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE servicos
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             duracao_minutos = COALESCE($3, duracao_minutos),
             preco = COALESCE($4, preco),
             ativo = COALESCE($5, ativo)
         WHERE id = $6 RETURNING *`,
        nome, descricao, duracao_minutos, preco, ativo, id
      );

      if (!res || res.length === 0) throw new NotFoundException('Service not found.');
      return { servico: res[0] };
    });
  }
}
