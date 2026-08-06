import pool, { queryTenant } from '../db/postgres.mjs';

/**
 * REGRA 2: Query de Listagem de Solicitações Públicas Pendentes
 * Filtra por horário de expediente, conflitos de agenda e serviços autorizados do profissional.
 */
export const GET_PUBLIC_REQUESTS_SQL = `
  SELECT a.id, 
         a.data_hora, 
         a.valor_total, 
         a.tipo_atendimento,
         c.nome as cliente_nome, 
         c.whatsapp as cliente_whatsapp,
         s.nome as servico_nome,
         s.duracao_minutos as servico_duracao
  FROM agendamentos a
  JOIN servicos s ON a.servico_id = s.id
  LEFT JOIN clientes c ON a.cliente_id = c.id
  WHERE a.status = 'aguardando_confirmacao'
    AND a.profissional_id IS NULL
    
    -- FILTRO DE SERVIÇO: O profissional está habilitado para este serviço
    AND EXISTS (
        SELECT 1 
        FROM profissional_servicos ps 
        WHERE ps.profissional_id = $1 
          AND ps.servico_id = a.servico_id 
          AND ps.ativo = true
    )
    
    -- FILTRO DE HORÁRIO: Horário dentro do expediente ativo do profissional
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
    
    -- FILTRO DE CONFLITO: Sem outros agendamentos ativos na mesma faixa de horário
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

/**
 * REGRA 5: Query de Listagem de Agendamentos Internos
 * Garante o isolamento estrito entre profissionais do mesmo Tenant.
 */
export const GET_INTERNAL_APPOINTMENTS_SQL = `
  SELECT a.id, 
         a.data_hora, 
         a.valor_total,
         a.status,
         c.nome as cliente_nome, 
         s.nome as servico_nome
  FROM agendamentos a
  LEFT JOIN clientes c ON a.cliente_id = c.id
  LEFT JOIN servicos s ON a.servico_id = s.id
  WHERE (
        -- O profissional logado visualiza apenas os seus próprios agendamentos (incluindo internos)
        a.profissional_id = $1
        OR
        -- Exibe solicitações abertas/públicas que ainda não foram aceitas por ninguém
        (a.profissional_id IS NULL AND a.status = 'aguardando_confirmacao')
    )
  ORDER BY a.data_hora ASC;
`;

/**
 * REGRAS 3 e 4: Função de Aceitar Agendamento com Concorrência e Cadastro de Cliente
 * 
 * @param {string} tenantSlug - Identificador do Tenant para search_path
 * @param {number} agendamentoId - ID da solicitação pública
 * @param {number} profissionalId - ID do profissional que está aceitando
 */
export async function aceitarAgendamento(tenantSlug, agendamentoId, profissionalId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Set schema
    const schemaName = `tenant_${tenantSlug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_')}`;
    await client.query(`SET search_path TO "${schemaName}", public;`);

    // 1. Atualização Atômica (Tratamento de Race Condition / Concorrência)
    // Apenas atualiza se profissional_id ainda for NULL e o status for pendente.
    const updateRes = await client.query(`
      UPDATE agendamentos
      SET profissional_id = $1,
          status = 'confirmado'
      WHERE id = $2
        AND profissional_id IS NULL
        AND status = 'aguardando_confirmacao'
      RETURNING *
    `, [profissionalId, agendamentoId]);

    // Se nenhum registro foi afetado, outro profissional já aceitou
    if (updateRes.rows.length === 0) {
      throw new Error('Esta solicitação já foi aceita por outro profissional ou não está mais disponível.');
    }

    const agendamento = updateRes.rows[0];

    // 2. Cadastro / Vínculo Automático de Cliente (Regra 4)
    let clienteId = agendamento.cliente_id;

    if (!clienteId) {
      // Se a solicitação pública salvou dados temporários no agendamento, cadastra o cliente
      const clienteNome = agendamento.temp_cliente_nome || 'Cliente Comum';
      const clienteWhatsapp = agendamento.temp_cliente_whatsapp || '';
      const clienteEmail = agendamento.temp_cliente_email || null;

      // Upsert baseado no whatsapp do cliente no tenant
      const clientRes = await client.query(`
        INSERT INTO clientes (nome, whatsapp, email, created_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (whatsapp) 
        DO UPDATE SET nome = EXCLUDED.nome, email = COALESCE(EXCLUDED.email, clientes.email)
        RETURNING id
      `, [clienteNome, clienteWhatsapp, clienteEmail]);

      clienteId = clientRes.rows[0].id;

      // Vincula o cliente cadastrado ao agendamento
      await client.query(`
        UPDATE agendamentos 
        SET cliente_id = $1 
        WHERE id = $2
      `, [clienteId, agendamento.id]);
    } else {
      // Se o cliente já existia, garante que ele está vinculado ao profissional que o atendeu (vínculo de carteira)
      await client.query(`
        UPDATE clientes 
        SET profissional_id = $1 
        WHERE id = $2 AND profissional_id IS NULL
      `, [profissionalId, clienteId]);
    }

    await client.query('COMMIT');
    return {
      success: true,
      agendamentoId: agendamento.id,
      clienteId
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
