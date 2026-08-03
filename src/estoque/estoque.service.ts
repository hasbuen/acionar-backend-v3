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

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO estoque_produtos (
          profissional_id, nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        user.profissional_id,
        nome,
        tipo || 'consumo',
        quantidade || 0,
        estoque_minimo || 1,
        custo_unitario || 0,
        imagem_url || null
      );

      const produto = res[0];

      if (quantidade > 0) {
        await this.prisma.$queryRawUnsafe(
          `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
           VALUES ($1, $2, 'entrada', $3, 'Estoque inicial cadastrado')`,
          produto.id, user.profissional_id, quantidade
        );
      }

      return { produto };
    });
  }

  async createMovimentacao(tenantSlug: string, user: any, dto: any) {
    const { produto_id, tipo, quantidade, motivo } = dto;
    if (!produto_id || !tipo || !quantidade) {
      throw new BadRequestException('Product ID, Type, and Quantity are required.');
    }

    const qtyNum = parseInt(quantidade, 10);

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const prodRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT quantidade FROM estoque_produtos WHERE id = $1',
        produto_id
      );
      if (!prodRes || prodRes.length === 0) throw new NotFoundException('Product not found.');

      const currentQty = parseInt(prodRes[0].quantidade || 0, 10);
      let newQty = currentQty;

      if (tipo === 'entrada') newQty += qtyNum;
      else if (tipo === 'saida') newQty = Math.max(0, currentQty - qtyNum);
      else if (tipo === 'ajuste') newQty = qtyNum;

      await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2', newQty, produto_id);

      const movRes: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        produto_id, user.profissional_id, tipo, qtyNum, motivo || null
      );

      return {
        message: 'Inventory movement recorded.',
        movimentacao: movRes[0],
        nova_quantidade: newQty,
      };
    });
  }

  async transferProduto(tenantSlug: string, user: any, dto: any) {
    const { produto_id, profissional_id, quantidade } = dto;
    const qtyNum = parseInt(quantidade, 10);
    if (!produto_id || !profissional_id || !qtyNum || qtyNum < 1) throw new BadRequestException('Product, recipient and quantity are required.');

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const sourceRows: any = await this.prisma.$queryRawUnsafe('SELECT * FROM estoque_produtos WHERE id = $1', produto_id);
      if (!sourceRows.length) throw new NotFoundException('Product not found.');
      const source = sourceRows[0];
      if (Number(source.quantidade) < qtyNum) throw new BadRequestException('Insufficient stock for this transfer.');
      const recipientRows: any = await this.prisma.$queryRawUnsafe('SELECT id, nome FROM profissionais WHERE id = $1 AND ativo = true', profissional_id);
      if (!recipientRows.length) throw new NotFoundException('Recipient professional not found.');

      await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = quantidade - $1 WHERE id = $2', qtyNum, produto_id);
      const targetRows: any = await this.prisma.$queryRawUnsafe('SELECT id FROM estoque_produtos WHERE profissional_id = $1 AND nome = $2 LIMIT 1', profissional_id, source.nome);
      let targetId = targetRows[0]?.id;
      if (targetId) await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = quantidade + $1 WHERE id = $2', qtyNum, targetId);
      else {
        const created: any = await this.prisma.$queryRawUnsafe(`INSERT INTO estoque_produtos (profissional_id, nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, profissional_id, source.nome, source.tipo, qtyNum, source.estoque_minimo, source.custo_unitario, source.imagem_url);
        targetId = created[0].id;
      }
      await this.prisma.$queryRawUnsafe(`INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo) VALUES ($1, $2, 'saida', $3, $4), ($5, $6, 'entrada', $7, $8)`, produto_id, user.profissional_id, qtyNum, `Envio para ${recipientRows[0].nome}`, targetId, profissional_id, qtyNum, `Recebido de ${user.nome || 'outro auxiliar'}`);
      return { message: 'Product transferred successfully.', produto_origem_id: produto_id, produto_destino_id: targetId, quantidade: qtyNum, profissional_destino: recipientRows[0] };
    });
  }
}
