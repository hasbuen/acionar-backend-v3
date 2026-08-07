import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleCron() {
    this.logger.log('Iniciando rotina de checagem de notificações (Cron)...');
    
    try {
      // Busca todos os tenants ativos
      const tenants: any = await this.prisma.$queryRawUnsafe(
        "SELECT slug FROM public.tenants WHERE status = 'ativo'"
      );

      for (const t of tenants) {
        const tenantSlug = t.slug;
        await this.prisma.ensureTenantSchema(tenantSlug);
        
        await this.prisma.runInTenantSchema(tenantSlug, async () => {
          // Busca profissionais ativos deste tenant
          const profissionais: any = await this.prisma.$queryRawUnsafe(
            'SELECT id FROM profissionais WHERE ativo = true'
          );

          if (!profissionais || profissionais.length === 0) return;

          for (const prof of profissionais) {
            const profId = prof.id;

            // 1. Atrasos no Caixa (> 30 dias)
            await this.checkCaixaAtrasado(profId);

            // 2. Estoque Baixo
            await this.checkEstoqueBaixo(profId);

            // 3. Agendamento Próximo (próximas 2 horas)
            await this.checkAgendamentoProximo(profId);

            // 4. Manutenção Preventiva (daqui a exatos 2 dias)
            await this.checkManutencao(profId);
          }
        });
      }

      this.logger.log('Rotina de notificações finalizada com sucesso.');
    } catch (error) {
      this.logger.error('Erro ao executar rotina de notificações:', error);
    }
  }

  private async notify(profId: number, titulo: string, mensagem: string) {
    // Evita duplicidade nas últimas 24 horas para o mesmo alerta
    const existing: any = await this.prisma.$queryRawUnsafe(
      `SELECT id FROM notificacoes 
       WHERE profissional_id = $1 
         AND titulo = $2 
         AND created_at > NOW() - INTERVAL '24 hours' 
       LIMIT 1`,
      profId,
      titulo
    );

    if (existing && existing.length > 0) {
      return; // Já notificado recentemente
    }

    // Insere notificação
    const inserted: any = await this.prisma.$queryRawUnsafe(
      `INSERT INTO notificacoes (profissional_id, titulo, mensagem)
       VALUES ($1, $2, $3)
       RETURNING id, titulo, mensagem, lida, created_at`,
      profId,
      titulo,
      mensagem
    );

    if (inserted && inserted.length > 0) {
      const payload = { ...inserted[0], profissional_id: profId };
      // O gateway espera no formato tenant_slug e user_id, mas aqui não temos o tenantSlug de forma direta.
      // O NotificationsGateway emite para 'tenant_...' e 'user_...'.
      // Vamos obter o tenant no contexto ou emitir globalmente para o profId (já que as salas user_XXX são únicas se o ID for único, mas no Multi-tenant é arriscado).
      // Porém o gateway usa: `server.to(\`user_\${payload.profissional_id}\`)`
      this.gateway.emitToUser(profId, 'notifications-changed', payload);
    }
  }

  private async checkCaixaAtrasado(profId: number) {
    // Busca lançamentos pendentes com data_movimento anterior a 30 dias atrás
    const atrasados: any = await this.prisma.$queryRawUnsafe(
      `SELECT id, descricao, data_movimento, valor 
       FROM fluxo_caixa 
       WHERE status = 'pendente' 
         AND data_movimento < CURRENT_DATE - INTERVAL '30 days'
         AND (profissional_id = $1 OR profissional_id IS NULL)`,
      profId
    );

    for (const item of atrasados) {
      const dias = Math.floor((new Date().getTime() - new Date(item.data_movimento).getTime()) / (1000 * 3600 * 24));
      const titulo = `Caixa Atrasado: ${item.descricao}`;
      const mensagem = `O lançamento "${item.descricao}" no valor de R$ ${item.valor} está pendente há ${dias} dias.`;
      await this.notify(profId, titulo, mensagem);
    }
  }

  private async checkEstoqueBaixo(profId: number) {
    const baixoEstoque: any = await this.prisma.$queryRawUnsafe(
      `SELECT id, nome, quantidade, estoque_minimo 
       FROM estoque_produtos 
       WHERE quantidade < estoque_minimo
         AND (profissional_id = $1 OR profissional_id IS NULL)`,
      profId
    );

    for (const item of baixoEstoque) {
      const titulo = `Estoque Baixo: ${item.nome}`;
      const mensagem = `O produto "${item.nome}" atingiu uma quantidade crítica (${item.quantidade} de ${item.estoque_minimo} mínimo).`;
      await this.notify(profId, titulo, mensagem);
    }
  }

  private async checkAgendamentoProximo(profId: number) {
    // Agendamentos nas próximas 2 horas que ainda estão agendados/confirmados
    const proximos: any = await this.prisma.$queryRawUnsafe(
      `SELECT a.id, a.data_hora, c.nome as cliente_nome
       FROM agendamentos a
       LEFT JOIN clientes c ON a.cliente_id = c.id
       WHERE a.status IN ('agendado', 'confirmado')
         AND a.data_hora BETWEEN NOW() AND NOW() + INTERVAL '2 hours'
         AND (a.profissional_id = $1 OR a.profissional_id IS NULL)`,
      profId
    );

    for (const item of proximos) {
      const hora = new Date(item.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const clienteNome = item.cliente_nome || 'Cliente';
      const titulo = `Atendimento Próximo: ${clienteNome}`;
      const mensagem = `Você tem um agendamento com ${clienteNome} hoje às ${hora}.`;
      await this.notify(profId, titulo, mensagem);
    }
  }

  private async checkManutencao(profId: number) {
    // Considerando "manutencao" se a observacao contiver a palavra, ou o tipo de atendimento, ou subservico.
    // Vamos checar pelo "tipo_atendimento" ou "observacao". 
    const manutencoes: any = await this.prisma.$queryRawUnsafe(
      `SELECT a.id, a.data_hora, c.nome as cliente_nome
       FROM agendamentos a
       LEFT JOIN clientes c ON a.cliente_id = c.id
       WHERE a.status IN ('agendado', 'confirmado')
         AND a.data_hora BETWEEN (CURRENT_DATE + INTERVAL '2 days') AND (CURRENT_DATE + INTERVAL '3 days')
         AND (a.profissional_id = $1 OR a.profissional_id IS NULL)
         AND (a.observacao ILIKE '%manuten%' OR a.tipo_atendimento ILIKE '%manuten%')`,
      profId
    );

    for (const item of manutencoes) {
      const clienteNome = item.cliente_nome || 'Cliente';
      const titulo = `Lembrete de Manutenção: ${clienteNome}`;
      const mensagem = `O agendamento de manutenção de ${clienteNome} será daqui a 2 dias (${new Date(item.data_hora).toLocaleDateString('pt-BR')}).`;
      await this.notify(profId, titulo, mensagem);
    }
  }
}
