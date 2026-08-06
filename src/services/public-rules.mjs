/**
 * SERVIÇOS PÚBLICOS E DESLOCAMENTO (DESLOCAMENTO / ATENDIMENTO EM DOMICÍLIO)
 * Este serviço implementa as regras de negócio solicitadas para a Rota Pública.
 */

import pool from '../db/postgres.mjs';

/**
 * 1. Endpoint: Retorna Serviços Disponíveis e se há Atendimento Domiciliar ativo no Tenant.
 * Garante que apenas serviços com pelo menos um profissional ativo vinculado sejam retornados.
 * 
 * @param {string} tenantSlug - Identificador do Tenant
 */
export async function getPublicServicesAndLocationAvailability(tenantSlug) {
  const schemaName = `tenant_${tenantSlug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_')}`;
  
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schemaName}", public;`);

    // Busca serviços que tenham pelo menos um profissional habilitado ativo
    const servicesQuery = await client.query(`
      SELECT DISTINCT s.id, s.nome, s.preco, s.duracao_minutos
      FROM servicos s
      JOIN profissional_servicos ps ON ps.servico_id = s.id
      JOIN profissionais p ON p.id = ps.profissional_id
      WHERE s.ativo = true 
        AND ps.ativo = true
        AND p.ativo = true
      ORDER BY s.nome ASC;
    `);

    // Valida se existe pelo menos um profissional ativo com deslocamento (atendimento no local) habilitado
    const locationAvailabilityQuery = await client.query(`
      SELECT EXISTS (
        SELECT 1 
        FROM profissionais 
        WHERE ativo = true 
          AND permite_atender_no_local = true
      ) as permite_externo;
    `);

    const permiteAtendimentoLocal = locationAvailabilityQuery.rows[0]?.permite_externo || false;

    return {
      services: servicesQuery.rows,
      permiteAtendimentoLocal
    };
  } finally {
    client.release();
  }
}

/**
 * 2. Endpoint: Busca de Horários Disponíveis Cruzando Serviço e Local de Atendimento.
 * Retorna os horários unificados (sem duplicidade) combinando a agenda de todos os profissionais aptos.
 * 
 * @param {string} tenantSlug - Identificador do Tenant
 * @param {string} dateStr - Data selecionada (YYYY-MM-DD)
 * @param {number} servicoId - ID do serviço selecionado
 * @param {boolean} isAtendimentoLocal - Se o cliente escolheu atendimento externo (domicílio)
 */
export async function getAvailableTimeSlots(tenantSlug, dateStr, servicoId, isAtendimentoLocal) {
  const schemaName = `tenant_${tenantSlug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_')}`;
  
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO "${schemaName}", public;`);

    // 1. Filtrar o subgrupo de profissionais aptos (fazem o serviço + atendem local se isAtendimentoLocal = true)
    const profsQuery = await client.query(`
      SELECT p.id, p.nome
      FROM profissionais p
      JOIN profissional_servicos ps ON ps.profissional_id = p.id
      WHERE p.ativo = true
        AND ps.servico_id = $1
        AND ps.ativo = true
        AND ($2 = false OR p.permite_atender_no_local = true)
    `, [servicoId, isAtendimentoLocal]);

    const profissionaisAptos = profsQuery.rows;
    if (profissionaisAptos.length === 0) {
      return []; // Nenhum profissional apto
    }

    const idsProfissionais = profissionaisAptos.map(p => p.id);

    // 2. Buscar a duração do serviço para cálculo das faixas de horário
    const servRes = await client.query('SELECT duracao_minutos FROM servicos WHERE id = $1', [servicoId]);
    if (servRes.rows.length === 0) {
      throw new Error('Serviço não encontrado.');
    }
    const duracaoServico = servRes.rows[0].duracao_minutos;

    // 3. Buscar os expedientes configurados para o dia da semana correspondente para os profissionais do grupo
    const dow = new Date(dateStr + 'T12:00:00').getDay(); // 0 = Domingo, 1 = Segunda, etc.
    const expedientesQuery = await client.query(`
      SELECT profissional_id, hora_inicio, hora_fim, almoco_inicio, almoco_fim
      FROM profissional_expedientes
      WHERE profissional_id = ANY($1)
        AND dia_semana = $2
        AND ativo = true
    `, [idsProfissionais, dow]);

    const expedientes = expedientesQuery.rows;

    // 4. Buscar agendamentos existentes (ocupados) para esses profissionais na data correspondente
    const agendamentosQuery = await client.query(`
      SELECT profissional_id, data_hora, duracao_total_minutos
      FROM agendamentos
      WHERE profissional_id = ANY($1)
        AND data_hora::date = $2::date
        AND status NOT IN ('cancelado', 'rejeitado')
    `, [idsProfissionais, dateStr]);

    const agendamentosExistentes = agendamentosQuery.rows;

    // 5. Algoritmo de geração e consolidação de horários unificados (sem duplicidade)
    const slotsUnificados = new Set();
    const intervaloMinutos = 30; // Intervalos de tempo da grade (ex: de 30 em 30 min)

    for (const prof of profissionaisAptos) {
      // Obter expediente do profissional
      const expediente = expedientes.find(e => e.profissional_id === prof.id);
      if (!expediente) continue; // Profissional não trabalha nesse dia

      const compromissos = agendamentosExistentes.filter(a => a.profissional_id === prof.id);

      // Converter "HH:MM:SS" ou "HH:MM" para minutos desde a meia-noite para facilitar cálculos
      const toMinutes = (timeStr) => {
        if (!timeStr) return 0;
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };

      const inicioExp = toMinutes(expendiente.hora_inicio);
      const fimExp = toMinutes(expendiente.hora_fim);
      const almocoIni = toMinutes(expendiente.almoco_inicio);
      const almocoFim = toMinutes(expendiente.almoco_fim);

      // Percorre a grade do dia para esse profissional
      for (let min = inicioExp; min + duracaoServico <= fimExp; min += intervaloMinutos) {
        // Verifica intervalo de almoço
        if (almocoIni && almocoFim && min < almocoFim && min + duracaoServico > almocoIni) {
          continue; // Conflito com almoço
        }

        // Verifica conflitos com agendamentos existentes
        let conflito = false;
        for (const comp of compromissos) {
          const compIni = new Date(comp.data_hora).getHours() * 60 + new Date(comp.data_hora).getMinutes();
          const compFim = compIni + comp.duracao_total_minutos;

          // Se sobrepõe
          if (min < compFim && min + duracaoServico > compIni) {
            conflito = true;
            break;
          }
        }

        if (!conflito) {
          // Adiciona o horário formatado (ex: "09:30") à lista única
          const h = String(Math.floor(min / 60)).padStart(2, '0');
          const m = String(min % 60).padStart(2, '0');
          slotsUnificados.add(`${h}:${m}`);
        }
      }
    }

    // Retorna ordenado
    return Array.from(slotsUnificados).sort();
  } finally {
    client.release();
  }
}

/**
 * 3. UPDATE na Listagem de Solicitações Pendentes (Painel Interno)
 * Consulta que os profissionais usam para ver solicitações públicas em aberto.
 * Adiciona a validação do tipo de atendimento (externo/domicílio vs local do estabelecimento).
 */
export const GET_PENDING_REQUESTS_WITH_LOCATION_SQL = `
  SELECT a.id, 
         a.data_hora, 
         a.valor_total, 
         a.tipo_atendimento,
         a.endereco_externo,
         c.nome as cliente_nome, 
         c.whatsapp as cliente_whatsapp,
         s.nome as servico_nome,
         s.duracao_minutos as servico_duracao
  FROM agendamentos a
  JOIN servicos s ON a.servico_id = s.id
  LEFT JOIN clientes c ON a.cliente_id = c.id
  WHERE a.status = 'aguardando_confirmacao'
    AND a.profissional_id IS NULL
    
    -- FILTRO DE SERVIÇO: Profissional deve fazer o serviço
    AND EXISTS (
        SELECT 1 
        FROM profissional_servicos ps 
        WHERE ps.profissional_id = $1 
          AND ps.servico_id = a.servico_id 
          AND ps.ativo = true
    )
    
    -- FILTRO DE LOCAL (NOVA REGRA): Se for externo (domicílio), o profissional deve possuir deslocamento ativo
    AND (
        a.tipo_atendimento <> 'cliente' 
        OR EXISTS (
            SELECT 1 
            FROM profissionais p
            WHERE p.id = $1 
              AND p.permite_atender_no_local = true
        )
    )
    
    -- FILTRO DE HORÁRIO: Deve bater com o expediente
    AND EXISTS (
        SELECT 1 
        FROM profissional_expedientes pe
        WHERE pe.profissional_id = $1
          AND pe.dia_semana = EXTRACT(DOW FROM a.data_hora)
          AND pe.ativo = true
          AND a.data_hora::time >= pe.hora_inicio
          AND (a.data_hora + (s.duracao_minutos || ' minutes')::INTERVAL)::time <= pe.hora_fim
          AND NOT (
              a.data_hora::time < pe.almoco_fim 
              AND (a.data_hora + (s.duracao_minutos || ' minutes')::INTERVAL)::time > pe.almoco_inicio
          )
    )
    
    -- FILTRO DE CONFLITO: Sem sobreposição de horários
    AND NOT EXISTS (
        SELECT 1 
        FROM agendamentos a2
        JOIN servicos s2 ON a2.servico_id = s2.id
        WHERE a2.profissional_id = $1
          AND a2.status NOT IN ('cancelado', 'aguardando_confirmacao')
          AND a2.data_hora < a.data_hora + (s.duracao_minutos || ' minutes')::INTERVAL
          AND a2.data_hora + (s2.duracao_minutos || ' minutes')::INTERVAL > a.data_hora
    )
  ORDER BY a.data_hora ASC;
`;
