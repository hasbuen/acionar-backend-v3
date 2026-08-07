import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';


// Statuses de agendamento que são excluídos do fluxo de caixa
const STATUSES_EXCLUIDOS = ['cancelado', 'solicitado', 'solicitacao', 'aguardando_confirmacao'];

@Injectable()
export class CaixaService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string, user: any, query: any) {
    const { data_inicio, data_fim, periodo } = query;
    await this.prisma.ensureTenantSchema(tenantSlug);

    const profId = user?.profissional_id;

    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      // ─── Monta filtros de data ─────────────────────────────────────────
      let dataInicio: string | null = data_inicio || null;
      let dataFim: string | null = data_fim || null;

      if (periodo) {
        const hoje = new Date();
        const fmt = (d: Date) => d.toISOString().split('T')[0];
        if (periodo === 'hoje') {
          dataInicio = dataFim = fmt(hoje);
        } else if (periodo === 'semana') {
          const ini = new Date(hoje);
          ini.setDate(hoje.getDate() - hoje.getDay());
          dataInicio = fmt(ini);
          dataFim = fmt(hoje);
        } else if (periodo === 'mes') {
          dataInicio = fmt(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
          dataFim = fmt(hoje);
        }
      }

      // ─── 1. Busca lançamentos reais de fluxo_caixa ────────────────────
      let sqlFC =
        `SELECT fc.id::text as id, fc.agendamento_id, fc.profissional_id, fc.cliente_id,
                fc.tipo, fc.categoria, fc.descricao, fc.valor, fc.status,
                fc.forma_pagamento, fc.data_movimento,
                COALESCE(c_direct.nome, c.nome) as cliente_nome, s.nome as servico_nome,
                'fluxo_caixa' as origem
         FROM fluxo_caixa fc
         LEFT JOIN agendamentos a ON fc.agendamento_id = a.id
         LEFT JOIN clientes c ON a.cliente_id = c.id
         LEFT JOIN clientes c_direct ON fc.cliente_id = c_direct.id
         LEFT JOIN servicos s ON a.servico_id = s.id
         WHERE (fc.categoria IS NULL OR fc.categoria <> 'ignorado')
           AND (fc.status IS NULL OR fc.status <> 'cancelado')`;
      const paramsFC: any[] = [];

      if (profId) {
        paramsFC.push(profId);
        sqlFC += ` AND fc.profissional_id = $${paramsFC.length}`;
      }


      if (dataInicio) {
        paramsFC.push(dataInicio);
        sqlFC += ` AND fc.data_movimento >= $${paramsFC.length}::date`;
      }
      if (dataFim) {
        paramsFC.push(dataFim);
        sqlFC += ` AND fc.data_movimento <= $${paramsFC.length}::date`;
      }
      sqlFC += ' ORDER BY fc.data_movimento DESC, fc.id DESC';

      const lancamentosReais: any[] = await this.prisma.$queryRawUnsafe(sqlFC, ...paramsFC);

      // IDs de agendamentos que já possuem lançamento ou foram ignorados no caixa
      const agIgnoradosOrLancados: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT DISTINCT agendamento_id FROM fluxo_caixa WHERE agendamento_id IS NOT NULL`
      );
      const agIdsIgnoradosOuLancados: number[] = agIgnoradosOrLancados.map((r) => Number(r.agendamento_id));

      // ─── 2. Busca agendamentos ativos sem lançamento em fluxo_caixa ───
      let sqlAG =
        `SELECT a.id, a.data_hora, a.valor_total, a.status, a.servico_id, a.subservico_id,
                c.nome as cliente_nome,
                s.nome as servico_nome,
                sub.nome as subservico_nome,
                sub.preco_adicional
         FROM agendamentos a
         LEFT JOIN clientes c ON a.cliente_id = c.id
         LEFT JOIN servicos s ON a.servico_id = s.id
         LEFT JOIN subservicos sub ON a.subservico_id = sub.id
         WHERE (a.status IS NULL OR LOWER(a.status) <> ALL($1::text[]))
           AND (
             $2::int[] IS NULL
             OR array_length($2::int[], 1) IS NULL
             OR a.id <> ALL($2::int[])
           )`;
      const paramsAG: any[] = [
        STATUSES_EXCLUIDOS.map((s) => s.toLowerCase()),
        agIdsIgnoradosOuLancados,
      ];

      if (profId) {
        paramsAG.push(profId);
        sqlAG += ` AND a.profissional_id = $${paramsAG.length}`;
      }


      if (dataInicio) {
        paramsAG.push(dataInicio);
        sqlAG += ` AND a.data_hora >= $${paramsAG.length}::date`;
      }
      if (dataFim) {
        paramsAG.push(dataFim);
        sqlAG += ` AND a.data_hora < ($${paramsAG.length}::date + INTERVAL '1 day')`;
      }
      sqlAG += ' ORDER BY a.data_hora DESC';


      const agendamentosOrfaos: any[] = await this.prisma.$queryRawUnsafe(sqlAG, ...paramsAG);

      // ─── 3. Busca produtos vinculados para gerar virtuais de insumo ───
      let produtosVirtuais: any[] = [];

      for (const ag of agendamentosOrfaos) {
        let servicoDesc = ag.servico_nome || 'Serviço';
        if (ag.subservico_nome) {
          servicoDesc += ` + ${ag.subservico_nome}`;
        }
        const clienteDesc = ag.cliente_nome || 'Cliente';

        const isPaid = ['pago', 'recebido', 'quitado', 'concluido', 'atendido'].includes(String(ag.status || '').toLowerCase());

        // Buscar insumos vinculados ao serviço
        const matsServico: any[] = ag.servico_id
          ? await this.prisma.$queryRawUnsafe(
              `SELECT sp.produto_id, sp.quantidade_usada, ep.nome as produto_nome, ep.custo_unitario
               FROM servico_produtos sp
               JOIN estoque_produtos ep ON sp.produto_id = ep.id
               WHERE sp.servico_id = $1`,
              ag.servico_id,
            )
          : [];

        // Buscar insumos vinculados ao subserviço
        const matsSubservico: any[] = ag.subservico_id
          ? await this.prisma.$queryRawUnsafe(
              `SELECT ssp.produto_id, ssp.quantidade_usada, ep.nome as produto_nome, ep.custo_unitario
               FROM subservico_produtos ssp
               JOIN estoque_produtos ep ON ssp.produto_id = ep.id
               WHERE ssp.subservico_id = $1`,
              ag.subservico_id,
            )
          : [];

        const todosMats = [...matsServico, ...matsSubservico];

        for (const mat of todosMats) {
          const custo = parseFloat(mat.custo_unitario || 0);
          if (custo > 0) {
            const totalCusto = mat.quantidade_usada * custo;
            produtosVirtuais.push({
              id: `ag-mat-${ag.id}-${mat.produto_id}`,
              agendamento_id: ag.id,
              profissional_id: null,
              tipo: 'saida',
              categoria: 'material',
              descricao: `Insumo: ${mat.produto_nome} (${mat.quantidade_usada} un) — ${clienteDesc} (${servicoDesc})`,
              valor: totalCusto,
              status: isPaid ? 'pago' : 'pendente',
              forma_pagamento: 'consumo',
              data_movimento: ag.data_hora,
              cliente_nome: clienteDesc,
              servico_nome: servicoDesc,
              origem: 'material',
            });
          }
        }
      }

      // ─── 4. Transforma agendamentos em lançamentos virtuais ──────────
      const lancamentosVirtuais = agendamentosOrfaos.map((ag) => {
        const isPaid = ['pago', 'recebido', 'quitado', 'concluido', 'atendido'].includes(String(ag.status || '').toLowerCase());
        let desc = `Atendimento — ${ag.cliente_nome || 'Cliente'} / ${ag.servico_nome || 'Serviço'}`;
        if (ag.subservico_nome) {
          desc += ` (+ ${ag.subservico_nome})`;
        }

        return {
          id: `ag-${ag.id}`,
          agendamento_id: ag.id,
          profissional_id: null,
          tipo: 'entrada',
          categoria: 'agendamento',
          descricao: desc,
          valor: ag.valor_total ?? 0,
          status: isPaid ? 'pago' : 'pendente',
          forma_pagamento: isPaid ? 'pix' : null,
          data_movimento: ag.data_hora,
          cliente_nome: ag.cliente_nome,
          servico_nome: ag.servico_nome,
          origem: 'agendamento',
        };
      });

      // ─── 5. Mescla e ordena por data desc ────────────────────────────
      const movimentacoes = [...lancamentosReais, ...lancamentosVirtuais, ...produtosVirtuais].sort((a, b) => {
        const da = new Date(a.data_movimento).getTime();
        const db = new Date(b.data_movimento).getTime();
        return db - da;
      });

      // ─── 6. Calcula resumo ────────────────────────────────────────────
      let totalEntradas = 0;
      let totalAReceber = 0;
      let totalSaidas = 0;
      let totalSaidasPendente = 0;
      let qtdPendentes = 0;
      let qtdRecebidos = 0;

      const byFormaPagamento: Record<string, number> = {
        pix: 0,
        cartao_credito: 0,
        cartao_debito: 0,
        dinheiro: 0,
      };

      const evolucaoMap = new Map<string, { date: string; entradas: number; saidas: number }>();

      movimentacoes.forEach((item: any) => {
        const val = parseFloat(item.valor || 0);
        const dateStr = item.data_movimento
          ? new Date(item.data_movimento).toISOString().split('T')[0]
          : 'Desconhecido';

        if (!evolucaoMap.has(dateStr)) {
          evolucaoMap.set(dateStr, { date: dateStr, entradas: 0, saidas: 0 });
        }
        const dayRecord = evolucaoMap.get(dateStr)!;

        if (item.tipo === 'entrada') {
          if (item.status === 'pago') {
            totalEntradas += val;
            qtdRecebidos++;
            dayRecord.entradas += val;
            const forma = (item.forma_pagamento || 'pix').toLowerCase();
            if (byFormaPagamento[forma] !== undefined) {
              byFormaPagamento[forma] += val;
            } else {
              byFormaPagamento.pix += val;
            }
          } else {
            totalAReceber += val;
            qtdPendentes++;
          }
        } else if (item.tipo === 'saida') {
          if (item.status === 'pago') {
            totalSaidas += val;
            dayRecord.saidas += val;
          } else {
            totalSaidasPendente += val;
          }
        }
      });

      const evolucao = Array.from(evolucaoMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      return {
        movimentacoes,
        resumo: {
          totalEntradas: Math.round(totalEntradas * 100) / 100,
          totalAReceber: Math.round(totalAReceber * 100) / 100,
          totalReceber: Math.round(totalAReceber * 100) / 100,
          totalSaidas: Math.round(totalSaidas * 100) / 100,
          totalSaidasPendente: Math.round(totalSaidasPendente * 100) / 100,
          saldo: Math.round((totalEntradas - totalSaidas) * 100) / 100,
          qtdPendentes,
          qtdRecebidos,
          byFormaPagamento,
          evolucao,
        },
      };
    });
  }

  async create(tenantSlug: string, user: any, dto: any) {
    const {
      agendamento_id,
      tipo,
      descricao,
      valor,
      status,
      forma_pagamento,
      data_movimento,
      categoria,
      cliente_id,
      produto_id,
      quantidade_produto,
    } = dto;

    if (!tipo || !descricao || valor === undefined) {
      throw new BadRequestException('Tipo, descrição e valor são obrigatórios.');
    }

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      // 1. Se for produto ou compra/venda de mercadoria, atualiza o estoque e registra movimentação
      if (categoria === 'compra_mercadoria' || categoria === 'venda_produto' || categoria === 'produto') {
        if (produto_id) {
          const qty = parseInt(quantidade_produto, 10);
          if (!isNaN(qty) && qty > 0) {
            const pId = parseInt(produto_id, 10);
            if (tipo === 'saida') {
              // Incrementa o produto no estoque (compra)
              await this.prisma.$executeRawUnsafe(
                'UPDATE estoque_produtos SET quantidade = quantidade + $1 WHERE id = $2',
                qty,
                pId
              );
              await this.prisma.$executeRawUnsafe(
                `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
                 VALUES ($1, $2, 'entrada', $3, $4)`,
                pId,
                user.profissional_id || null,
                qty,
                `Compra de mercadoria lançada no Caixa: ${descricao}`
              );
            } else if (tipo === 'entrada') {
              // Decrementa o produto no estoque (venda)
              await this.prisma.$executeRawUnsafe(
                'UPDATE estoque_produtos SET quantidade = GREATEST(0, quantidade - $1) WHERE id = $2',
                qty,
                pId
              );
              await this.prisma.$executeRawUnsafe(
                `INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
                 VALUES ($1, $2, 'saida', $3, $4)`,
                pId,
                user.profissional_id || null,
                qty,
                `Venda de produto lançada no Caixa: ${descricao}`
              );
            }
          }
        }
      }

      // 2. Registra o fluxo de caixa
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO fluxo_caixa (
          agendamento_id, profissional_id, cliente_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date) RETURNING *`,
        agendamento_id || null,
        user.profissional_id || null,
        cliente_id ? parseInt(cliente_id, 10) : null,
        tipo,
        categoria || null,
        descricao,
        valor,
        status || 'pago',
        forma_pagamento || 'pix',
        data_movimento || new Date().toISOString().split('T')[0],
      );
      return { movimentacao: res[0] };
    });
  }

  /**
   * Dar baixa em um lançamento pendente.
   * - Se id = "ag-<n>": cria o registro real no fluxo_caixa vinculado ao agendamento.
   * - Se id numérico: atualiza o status do registro existente para 'pago'.
   */
  async baixar(tenantSlug: string, user: any, id: string, forma_pagamento: string) {
    if (!forma_pagamento) {
      throw new BadRequestException('Forma de pagamento é obrigatória.');
    }

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      // ─── Lançamento virtual de agendamento ─────────────────────────
      if (String(id).startsWith('ag-')) {
        const cleanIdStr = String(id).replace('ag-mat-', '').replace('ag-', '');
        const agendamentoId = parseInt(cleanIdStr.split('-')[0], 10);

        const agRows: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT a.id, a.valor_total, a.data_hora,
                  c.nome as cliente_nome, s.nome as servico_nome, sub.nome as subservico_nome
           FROM agendamentos a
           LEFT JOIN clientes c ON a.cliente_id = c.id
           LEFT JOIN servicos s ON a.servico_id = s.id
           LEFT JOIN subservicos sub ON a.subservico_id = sub.id
           WHERE a.id = $1 AND (a.status IS NULL OR LOWER(a.status) <> ALL($2::text[]))`,
          agendamentoId,
          STATUSES_EXCLUIDOS.map((s) => s.toLowerCase()),
        );

        if (!agRows || agRows.length === 0) {
          throw new NotFoundException('Agendamento confirmado não encontrado.');
        }

        const ag = agRows[0];
        let descricao = `Atendimento — ${ag.cliente_nome || 'Cliente'} / ${ag.servico_nome || 'Serviço'}`;
        if (ag.subservico_nome) {
          descricao += ` (+ ${ag.subservico_nome})`;
        }
        const dataMovimento = new Date(ag.data_hora).toISOString().split('T')[0];

        const res: any = await this.prisma.$queryRawUnsafe(
          `INSERT INTO fluxo_caixa (agendamento_id, profissional_id, tipo, categoria, descricao, valor, status, forma_pagamento, data_movimento)
           VALUES ($1, $2, 'entrada', 'agendamento', $3, $4, 'pago', $5, $6::date) RETURNING *`,
          agendamentoId,
          user?.profissional_id || null,
          descricao,
          ag.valor_total ?? 0,
          forma_pagamento,
          dataMovimento,
        );


        return { movimentacao: res[0], message: 'Baixa realizada com sucesso.' };
      }

      // ─── Lançamento real existente ──────────────────────────────────
      const numericId = parseInt(id, 10);
      if (isNaN(numericId)) {
        throw new BadRequestException('ID de lançamento inválido.');
      }

      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE fluxo_caixa SET status = 'pago', forma_pagamento = $1
         WHERE id = $2 AND status = 'pendente'
         RETURNING *`,
        forma_pagamento,
        numericId,
      );

      if (!res || res.length === 0) {
        throw new NotFoundException('Lançamento pendente não encontrado ou já baixado.');
      }

      return { movimentacao: res[0], message: 'Baixa realizada com sucesso.' };
    });
  }

  async remove(tenantSlug: string, user: any, id: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      if (String(id).startsWith('ag-')) {
        const cleanIdStr = String(id).replace('ag-mat-', '').replace('ag-', '');
        const agendamentoId = parseInt(cleanIdStr.split('-')[0], 10);

        if (!isNaN(agendamentoId)) {
          await this.prisma.$queryRawUnsafe(
            `INSERT INTO fluxo_caixa (agendamento_id, profissional_id, tipo, categoria, descricao, valor, status, data_movimento)
             VALUES ($1, $2, 'saida', 'ignorado', 'Lançamento ocultado no caixa', 0, 'cancelado', CURRENT_DATE)`,
            agendamentoId,
            user?.profissional_id || null,
          );
        }
        return { message: 'Lançamento ocultado do caixa com sucesso.' };
      }


      const numericId = parseInt(String(id), 10);
      if (isNaN(numericId)) {
        throw new BadRequestException('ID de lançamento inválido.');
      }

      const existing: any = await this.prisma.$queryRawUnsafe(
        'SELECT profissional_id, agendamento_id FROM fluxo_caixa WHERE id = $1',
        numericId,
      );
      if (!existing || existing.length === 0) {
        throw new NotFoundException('Lançamento não encontrado.');
      }
      if (existing[0].profissional_id && existing[0].profissional_id !== user.profissional_id) {
        throw new ForbiddenException('Você só pode excluir lançamentos do seu próprio caixa.');
      }
      if (existing[0].agendamento_id) {
        throw new BadRequestException(`Este lançamento está vinculado ao agendamento #${existing[0].agendamento_id}. Para removê-lo, exclua ou cancele o agendamento correspondente.`);
      }

      await this.prisma.$queryRawUnsafe(
        'DELETE FROM fluxo_caixa WHERE id = $1',
        numericId,
      );

      return { message: 'Lançamento excluído com sucesso.' };
    });
  }
}

