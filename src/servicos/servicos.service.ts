import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServicosService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string, user?: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    const profId = user?.profissional_id;

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

      let profServicosMap = new Map<number, boolean>();
      let profSubservicosMap = new Map<number, boolean>();

      if (profId) {
        const ps: any = await this.prisma.$queryRawUnsafe(
          'SELECT servico_id, ativo FROM profissional_servicos WHERE profissional_id = $1',
          profId,
        );
        ps.forEach((r: any) => profServicosMap.set(Number(r.servico_id), Boolean(r.ativo)));

        const psub: any = await this.prisma.$queryRawUnsafe(
          'SELECT subservico_id, ativo FROM profissional_subservicos WHERE profissional_id = $1',
          profId,
        );
        psub.forEach((r: any) => profSubservicosMap.set(Number(r.subservico_id), Boolean(r.ativo)));
      }

      const result = servicos.map((s: any) => {
        const habServico = profServicosMap.has(s.id) ? profServicosMap.get(s.id) : true;
        return {
          ...s,
          habilitado_profissional: habServico,
          produtos: materiaisServico.filter((link: any) => link.servico_id === s.id),
          subservicos: subservicos
            .filter((sub: any) => sub.servico_id === s.id)
            .map((sub: any) => {
              const habSub = profSubservicosMap.has(sub.id) ? profSubservicosMap.get(sub.id) : true;
              return {
                ...sub,
                habilitado_profissional: habSub,
                produtos: materiaisSubservico.filter((link: any) => link.subservico_id === sub.id),
              };
            }),
        };
      });

      return { servicos: result };
    });
  }

  async toggleServicoAtendo(tenantSlug: string, user: any, servicoId: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const profId = user.profissional_id;
      const existing: any = await this.prisma.$queryRawUnsafe(
        'SELECT ativo FROM profissional_servicos WHERE profissional_id = $1 AND servico_id = $2',
        profId,
        servicoId,
      );

      const novoStatus = existing && existing.length > 0 ? !existing[0].ativo : false;

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO profissional_servicos (profissional_id, servico_id, ativo)
         VALUES ($1, $2, $3)
         ON CONFLICT (profissional_id, servico_id)
         DO UPDATE SET ativo = EXCLUDED.ativo`,
        profId,
        servicoId,
        novoStatus,
      );

      return { servico_id: servicoId, habilitado_profissional: novoStatus };
    });
  }

  async toggleSubservicoAtendo(tenantSlug: string, user: any, subservicoId: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const profId = user.profissional_id;
      const existing: any = await this.prisma.$queryRawUnsafe(
        'SELECT ativo FROM profissional_subservicos WHERE profissional_id = $1 AND subservico_id = $2',
        profId,
        subservicoId,
      );

      const novoStatus = existing && existing.length > 0 ? !existing[0].ativo : false;

      await this.prisma.$executeRawUnsafe(
        `INSERT INTO profissional_subservicos (profissional_id, subservico_id, ativo)
         VALUES ($1, $2, $3)
         ON CONFLICT (profissional_id, subservico_id)
         DO UPDATE SET ativo = EXCLUDED.ativo`,
        profId,
        subservicoId,
        novoStatus,
      );

      return { subservico_id: subservicoId, habilitado_profissional: novoStatus };
    });
  }


  async create(tenantSlug: string, user: any, dto: any) {
    const { nome, descricao, duracao_minutos, preco, ativo } = dto;
    if (!nome || preco === undefined) throw new BadRequestException('Name and Price are required.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO servicos (nome, descricao, duracao_minutos, preco, ativo, profissional_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        nome,
        descricao || null,
        duracao_minutos || 60,
        preco,
        ativo !== undefined ? ativo : true,
        user.profissional_id,
      );
      return { servico: res[0] };
    });
  }

  async update(tenantSlug: string, user: any, id: number, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const existing: any = await this.prisma.$queryRawUnsafe(
        `SELECT s.profissional_id, p.nome as profissional_nome
         FROM servicos s
         LEFT JOIN profissionais p ON s.profissional_id = p.id
         WHERE s.id = $1`,
        id,
      );
      if (!existing || existing.length === 0) throw new NotFoundException('Service not found.');
      if (existing[0].profissional_id && existing[0].profissional_id !== user.profissional_id) {
        const criador = existing[0].profissional_nome || 'outro profissional';
        throw new ForbiddenException(`Este serviço foi criado pelo profissional ${criador}.`);
      }


      const { nome, descricao, duracao_minutos, preco, ativo } = dto;
      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE servicos
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             duracao_minutos = COALESCE($3, duracao_minutos),
             preco = COALESCE($4, preco),
             ativo = COALESCE($5, ativo)
         WHERE id = $6 RETURNING *`,
        nome,
        descricao,
        duracao_minutos,
        preco,
        ativo,
        id,
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

  async deleteServico(tenantSlug: string, user: any, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const existing: any = await this.prisma.$queryRawUnsafe(
        `SELECT s.profissional_id, p.nome as profissional_nome
         FROM servicos s
         LEFT JOIN profissionais p ON s.profissional_id = p.id
         WHERE s.id = $1`,
        id,
      );
      if (!existing || existing.length === 0) throw new NotFoundException('Service not found.');
      if (existing[0].profissional_id && existing[0].profissional_id !== user.profissional_id) {
        const criador = existing[0].profissional_nome || 'outro profissional';
        throw new ForbiddenException(`Este serviço foi criado pelo profissional ${criador}.`);
      }


      const res: any = await this.prisma.$queryRawUnsafe(
        'DELETE FROM servicos WHERE id = $1 RETURNING id',
        id,
      );
      if (!res || res.length === 0) throw new NotFoundException('Service not found.');
      return { message: 'Service deleted successfully.' };
    });
  }


  async createSubservico(tenantSlug: string, user: any, servicoId: number, dto: any) {
    const { nome, duracao_adicional_minutos, preco_adicional, ativo } = dto;
    if (!nome) throw new BadRequestException('Name is required for subservice.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO subservicos (servico_id, nome, duracao_adicional_minutos, preco_adicional, ativo, profissional_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        servicoId,
        nome,
        duracao_adicional_minutos || 0,
        preco_adicional || 0.00,
        ativo !== undefined ? ativo : true,
        user.profissional_id,
      );
      return { subservico: res[0] };
    });
  }

  async updateSubservico(tenantSlug: string, user: any, subservicoId: number, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const existing: any = await this.prisma.$queryRawUnsafe(
        `SELECT s.profissional_id, p.nome as profissional_nome
         FROM subservicos s
         LEFT JOIN profissionais p ON s.profissional_id = p.id
         WHERE s.id = $1`,
        subservicoId,
      );
      if (!existing || existing.length === 0) throw new NotFoundException('Subservice not found.');
      if (existing[0].profissional_id && existing[0].profissional_id !== user.profissional_id) {
        const criador = existing[0].profissional_nome || 'outro profissional';
        throw new ForbiddenException(`Este subserviço foi criado pelo profissional ${criador}.`);
      }


      const { nome, duracao_adicional_minutos, preco_adicional, ativo } = dto;
      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE subservicos
         SET nome = COALESCE($1, nome),
             duracao_adicional_minutos = COALESCE($2, duracao_adicional_minutos),
             preco_adicional = COALESCE($3, preco_adicional),
             ativo = COALESCE($4, ativo)
         WHERE id = $5 RETURNING *`,
        nome,
        duracao_adicional_minutos,
        preco_adicional,
        ativo,
        subservicoId,
      );

      if (!res || res.length === 0) throw new NotFoundException('Subservice not found.');
      return { subservico: res[0] };
    });
  }

  async deleteSubservico(tenantSlug: string, user: any, subservicoId: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const existing: any = await this.prisma.$queryRawUnsafe(
        `SELECT s.profissional_id, p.nome as profissional_nome
         FROM subservicos s
         LEFT JOIN profissionais p ON s.profissional_id = p.id
         WHERE s.id = $1`,
        subservicoId,
      );
      if (!existing || existing.length === 0) throw new NotFoundException('Subservice not found.');
      if (existing[0].profissional_id && existing[0].profissional_id !== user.profissional_id) {
        const criador = existing[0].profissional_nome || 'outro profissional';
        throw new ForbiddenException(`Este subserviço foi criado pelo profissional ${criador}.`);
      }


      const res: any = await this.prisma.$queryRawUnsafe(
        'DELETE FROM subservicos WHERE id = $1 RETURNING id',
        subservicoId,
      );
      if (!res || res.length === 0) throw new NotFoundException('Subservice not found.');
      return { message: 'Subservice deleted successfully.' };
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

