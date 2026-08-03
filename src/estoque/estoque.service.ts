import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EstoqueService {
  constructor(private readonly prisma: PrismaService) {}

  async findProdutos(tenantSlug: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const produtos: any = await this.prisma.$queryRawUnsafe('SELECT * FROM estoque_produtos ORDER BY nome ASC');
      return { produtos };
    });
  }

  async createProduto(tenantSlug: string, user: any, dto: any) {
    const { nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url } = dto;
    if (!nome) throw new BadRequestException('Product name is required.');

    const qtd = parseInt(quantidade || 0, 10);
    const custo = parseFloat(custo_unitario || 0);

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO estoque_produtos (
          profissional_id, nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        user.profissional_id,
        nome,
        tipo || 'consumo',
        qtd,
        estoque_minimo || 1,
        custo,
        imagem_url || null
      );

      const produto = res[0];

      if (qtd > 0) {
        await this.prisma.$queryRawUnsafe(
          `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
           VALUES ($1, $2, 'entrada', $3, 'Estoque inicial cadastrado')`,
          produto.id, user.profissional_id, qtd
        );

        if (custo > 0) {
          const totalCusto = qtd * custo;
          await this.prisma.$queryRawUnsafe(
            `INSERT INTO fluxo_caixa (
              profissional_id, tipo, descricao, valor, status, forma_pagamento, data_movimento
            ) VALUES ($1, 'saida', $2, $3, 'pago', 'pix', CURRENT_DATE)`,
            user.profissional_id,
            `Compra de Insumo/Produto: ${nome} (${qtd} un)`,
            totalCusto
          );
        }
      }

      return { produto };
    });
  }

  async createMovimentacao(tenantSlug: string, user: any, dto: any) {
    const { produto_id, tipo, quantidade, motivo } = dto;
    if (!produto_id || !tipo || !quantidade) {
      throw new BadRequestException('ID do Produto, Tipo e Quantidade são obrigatórios.');
    }

    const qtyNum = parseInt(quantidade, 10);

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const prodRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM estoque_produtos WHERE id = $1',
        produto_id
      );
      if (!prodRes || prodRes.length === 0) throw new NotFoundException('Produto não encontrado.');

      const produto = prodRes[0];
      const novaQtd = tipo === 'entrada' ? produto.quantidade + qtyNum : Math.max(0, produto.quantidade - qtyNum);

      await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2', novaQtd, produto_id);

      const movRes: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        produto_id, user.profissional_id, tipo, qtyNum, motivo || null
      );

      const custo = parseFloat(produto.custo_unitario || 0);
      if (custo > 0) {
        const total = qtyNum * custo;
        const desc = `${tipo === 'entrada' ? 'Compra/Entrada' : 'Baixa'} de Estoque: ${produto.nome} (${qtyNum} un)`;

        await this.prisma.$queryRawUnsafe(
          `INSERT INTO fluxo_caixa (
            profissional_id, tipo, descricao, valor, status, forma_pagamento, data_movimento
          ) VALUES ($1, $2, $3, $4, 'pago', 'pix', CURRENT_DATE)`,
          user.profissional_id,
          tipo === 'entrada' ? 'saida' : 'entrada',
          desc,
          total
        );
      }

      return { movimentacao: movRes[0], nova_quantidade: novaQtd };
    });
  }

  async transferProduto(tenantSlug: string, user: any, dto: any) {
    const { produto_id, profissional_destino_id, quantidade } = dto;
    if (!produto_id || !quantidade) {
      throw new BadRequestException('Produto e quantidade são obrigatórios.');
    }

    const qtyNum = parseInt(quantidade, 10);
    await this.prisma.ensureTenantSchema(tenantSlug);

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const prodRes: any = await this.prisma.$queryRawUnsafe('SELECT * FROM estoque_produtos WHERE id = $1', produto_id);
      if (!prodRes || prodRes.length === 0) throw new NotFoundException('Produto não encontrado.');

      const produto = prodRes[0];
      const novaQtd = Math.max(0, produto.quantidade - qtyNum);
      await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2', novaQtd, produto_id);

      await this.prisma.$queryRawUnsafe(
        `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
         VALUES ($1, $2, 'saida', $3, $4)`,
        produto_id, user.profissional_id, qtyNum, `Transferência para profissional ${profissional_destino_id || 'auxiliar'}`
      );

      return { message: 'Transferência concluída com sucesso.', nova_quantidade: novaQtd };
    });
  }
}
