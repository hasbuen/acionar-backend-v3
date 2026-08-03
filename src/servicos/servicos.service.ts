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
      const materiaisServico: any = await this.prisma.$queryRawUnsafe(`
        SELECT sp.servico_id, sp.produto_id, sp.quantidade_usada, ep.nome as produto_nome
        FROM servico_produtos sp
        JOIN estoque_produtos ep ON sp.produto_id = ep.id
        ORDER BY ep.nome ASC
      `);
      const materiaisSubservico: any = await this.prisma.$queryRawUnsafe(`
        SELECT ssp.subservico_id, ssp.produto_id, ssp.quantidade_usada, ep.nome as produto_nome
        FROM subservico_produtos ssp
        JOIN estoque_produtos ep ON ssp.produto_id = ep.id
        ORDER BY ep.nome ASC
      `);

      const result = servicos.map(s => ({
        ...s,
        produtos: materiaisServico.filter(link => link.servico_id === s.id),
        subservicos: subservicos
          .filter(sub => sub.servico_id === s.id)
          .map(sub => ({
            ...sub,
            produtos: materiaisSubservico.filter(link => link.subservico_id === sub.id),
          })),
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

  async vincularProduto(tenantSlug: string, servicoId: number, dto: any) {
    const { produto_id, quantidade_usada } = dto;
    if (!produto_id) throw new BadRequestException('Product ID is required.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO servico_produtos (servico_id, produto_id, quantidade_usada)
         VALUES ($1, $2, $3) 
         ON CONFLICT (servico_id, produto_id) DO UPDATE SET quantidade_usada = $3
         RETURNING *`,
        servicoId, produto_id, quantidade_usada || 1
      );
      return { vinculo: res[0] };
    });
  }

  async removerVinculoProduto(tenantSlug: string, servicoId: number, produtoId: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        'DELETE FROM servico_produtos WHERE servico_id = $1 AND produto_id = $2 RETURNING id',
        servicoId, produtoId
      );
      if (!res || res.length === 0) throw new NotFoundException('Link not found.');
      return { message: 'Product link removed successfully.' };
    });
  }

  async listarProdutosServico(tenantSlug: string, servicoId: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const produtos: any = await this.prisma.$queryRawUnsafe(
        `SELECT ep.*, sp.quantidade_usada 
         FROM servico_produtos sp
         JOIN estoque_produtos ep ON sp.produto_id = ep.id
         WHERE sp.servico_id = $1
         ORDER BY ep.nome ASC`,
        servicoId
      );
      return { produtos };
    });
  }

  async vincularProdutoSubservico(tenantSlug: string, subservicoId: number, dto: any) {
    const { produto_id, quantidade_usada } = dto;
    if (!produto_id) throw new BadRequestException('Product ID is required.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO subservico_produtos (subservico_id, produto_id, quantidade_usada)
         VALUES ($1, $2, $3)
         ON CONFLICT (subservico_id, produto_id) DO UPDATE SET quantidade_usada = $3
         RETURNING *`,
        subservicoId, produto_id, quantidade_usada || 1
      );
      return { vinculo: res[0] };
    });
  }

  async removerVinculoProdutoSubservico(tenantSlug: string, subservicoId: number, produtoId: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        'DELETE FROM subservico_produtos WHERE subservico_id = $1 AND produto_id = $2 RETURNING id',
        subservicoId, produtoId
      );
      if (!res || res.length === 0) throw new NotFoundException('Link not found.');
      return { message: 'Product link removed successfully.' };
    });
  }

  async listarProdutosSubservico(tenantSlug: string, subservicoId: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const produtos: any = await this.prisma.$queryRawUnsafe(
        `SELECT ep.*, ssp.quantidade_usada
         FROM subservico_produtos ssp
         JOIN estoque_produtos ep ON ssp.produto_id = ep.id
         WHERE ssp.subservico_id = $1
         ORDER BY ep.nome ASC`,
        subservicoId
      );
      return { produtos };
    });
  }
}
