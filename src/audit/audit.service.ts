import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditLogItem {
  id: string;
  acao: string;
  entidade: 'agendamentos' | 'caixa' | 'estoque' | 'clientes' | 'auth';
  detalhes: string;
  data: string;
  created_at: Date;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async getAuditLogs(tenantSlug: string, user: any): Promise<{ logs: AuditLogItem[] }> {
    try {
      const logs: AuditLogItem[] = [];

      await this.prisma.runInTenantSchema(tenantSlug, async () => {
        // 1. Agendamentos recentes
        const agendamentos = await this.prisma.agendamento.findMany({
          take: 10,
          orderBy: { created_at: 'desc' },
          include: { cliente: true, servico: true },
        });

        agendamentos.forEach((a) => {
          logs.push({
            id: `agendamento-${a.id}`,
            acao: `Agendamento ${a.status.toUpperCase()}`,
            entidade: 'agendamentos',
            detalhes: `${a.cliente?.nome || 'Cliente'} — ${a.servico?.nome || 'Serviço'} (R$ ${Number(a.valor_total).toFixed(2)})`,
            data: new Date(a.created_at).toLocaleString('pt-BR'),
            created_at: new Date(a.created_at),
          });
        });

        // 2. Fluxo de Caixa recente
        const movimentacoesCaixa = await this.prisma.fluxoCaixa.findMany({
          take: 10,
          orderBy: { created_at: 'desc' },
        });

        movimentacoesCaixa.forEach((c) => {
          logs.push({
            id: `caixa-${c.id}`,
            acao: `Lançamento de Caixa (${c.tipo.toUpperCase()})`,
            entidade: 'caixa',
            detalhes: `${c.descricao} — R$ ${Number(c.valor).toFixed(2)} [${c.forma_pagamento.toUpperCase()}]`,
            data: new Date(c.created_at).toLocaleString('pt-BR'),
            created_at: new Date(c.created_at),
          });
        });

        // 3. Movimentações de Estoque
        const estoqueMov = await this.prisma.estoqueMovimentacao.findMany({
          take: 10,
          orderBy: { created_at: 'desc' },
          include: { produto: true },
        });

        estoqueMov.forEach((e) => {
          logs.push({
            id: `estoque-${e.id}`,
            acao: `Movimentação de Estoque (${e.tipo.toUpperCase()})`,
            entidade: 'estoque',
            detalhes: `${e.produto?.nome || 'Produto'} — Qtd: ${e.quantidade} ${e.motivo ? `(${e.motivo})` : ''}`,
            data: new Date(e.created_at).toLocaleString('pt-BR'),
            created_at: new Date(e.created_at),
          });
        });
      });

      // 4. Sessão do Usuário
      if (user) {
        logs.push({
          id: `auth-${user.id || 'session'}`,
          acao: 'Sessão Ativa Autenticada',
          entidade: 'auth',
          detalhes: `Usuário ${user.nome || user.email} conectado (${user.cargo || 'membro'})`,
          data: new Date().toLocaleString('pt-BR'),
          created_at: new Date(),
        });
      }

      // Ordena por data decrescente
      logs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

      return { logs: logs.slice(0, 20) };
    } catch (e) {
      console.error('[AUDIT ERROR]', e);
      return { logs: [] };
    }
  }
}
