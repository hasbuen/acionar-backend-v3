import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';


@Injectable()
export class EstoqueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsGateway: NotificationsGateway,
  ) {}

  async findProdutos(tenantSlug: string, user?: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    const profId = user?.profissional_id;

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      let sql = 'SELECT * FROM estoque_produtos WHERE 1=1';
      const params: any[] = [];

      if (profId) {
        params.push(profId);
        sql += ` AND profissional_id = $${params.length}`;
      }


      sql += ' ORDER BY nome ASC';

      const produtos: any = await this.prisma.$queryRawUnsafe(sql, ...params);

      let totalValor = 0;
      let produtosAlerta = 0;

      produtos.forEach((p: any) => {
        const valor = parseFloat(p.custo_unitario || 0) * (p.quantidade || 0);
        totalValor += valor;
        if (p.quantidade <= p.estoque_minimo) {
          produtosAlerta++;
        }
      });

      return {
        produtos,
        resumo: {
          total_produtos: produtos.length,
          valor_total_estoque: Math.round(totalValor * 100) / 100,
          produtos_em_alerta: produtosAlerta,
          estado_geral: produtosAlerta > 0 ? 'com-alertas' : 'ok',
        },
      };
    });
  }

  async createProduto(tenantSlug: string, user: any, dto: any) {
    const { nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url, status_pagamento } = dto;
    if (!nome) throw new BadRequestException('Nome do produto é obrigatório.');

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
        imagem_url || null,
      );

      const produto = res[0];

      if (qtd > 0) {
        await this.prisma.$queryRawUnsafe(
          `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
           VALUES ($1, $2, 'entrada', $3, 'Estoque inicial cadastrado')`,
          produto.id,
          user.profissional_id,
          qtd,
        );

        if (custo > 0) {
          const totalCusto = qtd * custo;
          const statusPag = status_pagamento || 'pago';
          await this.prisma.$queryRawUnsafe(
            `INSERT INTO fluxo_caixa (
              profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento
            ) VALUES ($1, 'saida', 'material', $2, $3, $4, 'dinheiro', CURRENT_DATE)`,
            user.profissional_id,
            `Compra de Insumo: ${nome} (${qtd} un × R$ ${custo.toFixed(2)})`,
            totalCusto,
            statusPag,
          );
        }
      }

      return { produto };
    });
  }

  async createMovimentacao(tenantSlug: string, user: any, dto: any) {
    const { produto_id, tipo, quantidade, motivo, status_pagamento } = dto;
    if (!produto_id || !tipo || !quantidade) {
      throw new BadRequestException('ID do Produto, Tipo e Quantidade são obrigatórios.');
    }

    const qtyNum = parseInt(quantidade, 10);

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const prodRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM estoque_produtos WHERE id = $1',
        produto_id,
      );
      if (!prodRes || prodRes.length === 0) throw new NotFoundException('Produto não encontrado.');

      const produto = prodRes[0];
      if (produto.profissional_id && produto.profissional_id !== user.profissional_id) {
        throw new ForbiddenException('Você só pode movimentar produtos de sua propriedade.');
      }

      const novaQtd = tipo === 'entrada' ? produto.quantidade + qtyNum : Math.max(0, produto.quantidade - qtyNum);


      await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2', novaQtd, produto_id);

      const movRes: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        produto_id,
        user.profissional_id,
        tipo,
        qtyNum,
        motivo || null,
      );

      const custo = parseFloat(produto.custo_unitario || 0);
      if (custo > 0 && tipo === 'entrada') {
        const total = qtyNum * custo;
        const desc = `Reposição de Estoque: ${produto.nome} (${qtyNum} un × R$ ${custo.toFixed(2)})`;
        const statusPag = status_pagamento || 'pago';

        await this.prisma.$queryRawUnsafe(
          `INSERT INTO fluxo_caixa (
            profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento
          ) VALUES ($1, 'saida', 'material', $2, $3, $4, 'dinheiro', CURRENT_DATE)`,
          user.profissional_id,
          desc,
          total,
          statusPag,
        );
      }

      return { movimentacao: movRes[0], nova_quantidade: novaQtd };
    });
  }

  async transferProduto(tenantSlug: string, user: any, dto: any) {
    const { produto_id, profissional_destino_id, quantidade } = dto;
    if (!produto_id || !quantidade || !profissional_destino_id) {
      throw new BadRequestException('Produto, quantidade e profissional de destino são obrigatórios.');
    }

    const qtyNum = parseInt(quantidade, 10);
    const destProfId = parseInt(profissional_destino_id, 10);
    await this.prisma.ensureTenantSchema(tenantSlug);

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const prodRes: any = await this.prisma.$queryRawUnsafe('SELECT * FROM estoque_produtos WHERE id = $1', produto_id);
      if (!prodRes || prodRes.length === 0) throw new NotFoundException('Produto não encontrado no estoque.');

      const produtoOrigem = prodRes[0];
      if (produtoOrigem.profissional_id && produtoOrigem.profissional_id !== user.profissional_id) {
        throw new ForbiddenException('Você só pode transferir produtos de sua propriedade.');
      }

      if (produtoOrigem.quantidade < qtyNum) {
        throw new BadRequestException(`Saldo insuficiente em estoque (${produtoOrigem.quantidade} disponíveis).`);
      }


      // 1. Debita quantidade do produto de origem
      const novaQtdOrigem = produtoOrigem.quantidade - qtyNum;
      await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2', novaQtdOrigem, produto_id);

      // Registra movimentacao de saida no remetente
      await this.prisma.$queryRawUnsafe(
        `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
         VALUES ($1, $2, 'saida', $3, $4)`,
        produto_id,
        user.profissional_id,
        qtyNum,
        `Transferência enviada para o profissional #${destProfId}`,
      );

      // 2. Transfere para o produto do destinatario (cria se nao existir)
      const destProdRes: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM estoque_produtos WHERE nome = $1 AND profissional_id = $2',
        produtoOrigem.nome,
        destProfId,
      );

      let destProdId: number;
      if (destProdRes && destProdRes.length > 0) {
        destProdId = destProdRes[0].id;
        const novaQtdDest = destProdRes[0].quantidade + qtyNum;
        await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2', novaQtdDest, destProdId);
      } else {
        const newProd: any = await this.prisma.$queryRawUnsafe(
          `INSERT INTO estoque_produtos (
            profissional_id, nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url
          ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          destProfId,
          produtoOrigem.nome,
          produtoOrigem.tipo,
          qtyNum,
          produtoOrigem.estoque_minimo,
          produtoOrigem.custo_unitario,
          produtoOrigem.imagem_url,
        );
        destProdId = newProd[0].id;
      }

      // Notification
      let nomeRemetente = user?.nome;
      if (!nomeRemetente && user?.profissional_id) {
        const senderRes: any = await this.prisma.$queryRawUnsafe('SELECT nome FROM profissionais WHERE id = $1', user.profissional_id);
        if (senderRes && senderRes.length > 0) nomeRemetente = senderRes[0].nome;
      }
      if (!nomeRemetente) nomeRemetente = 'Um colega';

      const titulo = 'Transferência de Estoque';
      const mensagem = `O usuário ${nomeRemetente} transferiu ${qtyNum} unidades do produto ${produtoOrigem.nome} para o seu estoque.`;

      const insertedNotif: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO notificacoes (profissional_id, titulo, mensagem)
         VALUES ($1, $2, $3)
         RETURNING id, titulo, mensagem, lida, created_at`,
        destProfId,
        titulo,
        mensagem
      );

      if (insertedNotif && insertedNotif.length > 0) {
        this.notificationsGateway.emitToUser(
          destProfId,
          'notifications-changed',
          { ...insertedNotif[0], profissional_id: destProfId }
        );
      }

      // Registra movimentacao de entrada no destinatario
      await this.prisma.$queryRawUnsafe(
        `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
         VALUES ($1, $2, 'entrada', $3, $4)`,
        destProdId,
        destProfId,
        qtyNum,
        `Transferência recebida do profissional #${user.profissional_id}`,
      );

      return { message: 'Transferência de produto realizada com sucesso.', nova_quantidade: novaQtdOrigem };
    });
  }

  async findMovimentacoes(tenantSlug: string, user: any, query: any) {
    const { produto_id, tipo, data_inicio, data_fim } = query;
    await this.prisma.ensureTenantSchema(tenantSlug);
    const profId = user?.profissional_id;

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      let sql = `
        SELECT em.*, ep.nome as produto_nome, p.nome as profissional_nome
        FROM estoque_movimentacoes em
        JOIN estoque_produtos ep ON em.produto_id = ep.id
        LEFT JOIN profissionais p ON em.profissional_id = p.id
        WHERE 1=1
      `;
      const params: any[] = [];

      if (profId) {
        params.push(profId);
        sql += ` AND em.profissional_id = $${params.length}`;
      }


      if (produto_id) {
        params.push(produto_id);
        sql += ` AND em.produto_id = $${params.length}`;
      }
      if (tipo) {
        params.push(tipo);
        sql += ` AND em.tipo = $${params.length}`;
      }
      if (data_inicio) {
        params.push(data_inicio);
        sql += ` AND em.created_at >= $${params.length}::date`;
      }
      if (data_fim) {
        params.push(data_fim);
        sql += ` AND em.created_at <= $${params.length}::date`;
      }

      sql += ' ORDER BY em.created_at DESC LIMIT 200';

      const movimentacoes: any = await this.prisma.$queryRawUnsafe(sql, ...params);
      return { movimentacoes };
    });
  }

  async findAlerts(tenantSlug: string, user?: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    const profId = user?.profissional_id;

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      let sql = `SELECT id, nome, quantidade, estoque_minimo, (estoque_minimo - quantidade) as deficit
                 FROM estoque_produtos
                 WHERE quantidade <= estoque_minimo`;
      const params: any[] = [];

      if (profId) {
        params.push(profId);
        sql += ` AND profissional_id = $${params.length}`;
      }


      sql += ' ORDER BY deficit DESC';

      const alertas: any = await this.prisma.$queryRawUnsafe(sql, ...params);

      return {
        alertas,
        total_alertas: alertas.length,
        urgencia: alertas.length > 5 ? 'alta' : alertas.length > 0 ? 'media' : 'nenhuma',
      };
    });
  }
}
