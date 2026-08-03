import pool, { getTenantSchemaName, queryPublic } from './postgres.mjs';

/**
 * Initialize global tables in public schema
 */
export async function initPublicSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.tenants (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(64) UNIQUE NOT NULL,
        nome_empresa VARCHAR(120) NOT NULL,
        email_proprietario VARCHAR(120) NOT NULL,
        telefone VARCHAR(30),
        senha_hash TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'ativo',
        foto_url TEXT,
        cor_primaria VARCHAR(10) DEFAULT '#0d9488',
        cor_destaque VARCHAR(10) DEFAULT '#f59e0b',
        cor_fundo VARCHAR(10) DEFAULT '#0f172a',
        agenda_publica_ativa BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('[MIGRATION] Public schema master tables initialized.');
  } finally {
    client.release();
  }
}

/**
 * Create and migrate schema for a specific tenant
 */
export async function initTenantSchema(tenantSlug) {
  const client = await pool.connect();
  const schemaName = getTenantSchemaName(tenantSlug);
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
    await client.query(`SET search_path TO "${schemaName}", public;`);

    // 1. Profissionais
    await client.query(`
      CREATE TABLE IF NOT EXISTS profissionais (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        email VARCHAR(120) UNIQUE NOT NULL,
        telefone VARCHAR(30),
        cargo VARCHAR(30) DEFAULT 'auxiliar',
        foto_url TEXT,
        ativo BOOLEAN DEFAULT true,
        senha_hash TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Servicos
    await client.query(`
      CREATE TABLE IF NOT EXISTS servicos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        descricao TEXT,
        duracao_minutos INT DEFAULT 60,
        preco DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 3. Subservicos
    await client.query(`
      CREATE TABLE IF NOT EXISTS subservicos (
        id SERIAL PRIMARY KEY,
        servico_id INT REFERENCES servicos(id) ON DELETE CASCADE,
        nome VARCHAR(100) NOT NULL,
        duracao_adicional_minutos INT DEFAULT 0,
        preco_adicional DECIMAL(10, 2) DEFAULT 0.00,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 4. Clientes
    await client.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        whatsapp VARCHAR(30),
        email VARCHAR(120),
        observacoes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 5. Agendamentos
    await client.query(`
      CREATE TABLE IF NOT EXISTS agendamentos (
        id SERIAL PRIMARY KEY,
        cliente_id INT REFERENCES clientes(id) ON DELETE SET NULL,
        profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL,
        servico_id INT REFERENCES servicos(id) ON DELETE SET NULL,
        subservico_id INT REFERENCES subservicos(id) ON DELETE SET NULL,
        data_hora TIMESTAMP WITH TIME ZONE NOT NULL,
        duracao_total_minutos INT DEFAULT 60,
        valor_total DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        status VARCHAR(30) DEFAULT 'agendado',
        observacao TEXT,
        tipo_atendimento VARCHAR(30) DEFAULT 'salao',
        endereco_externo TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 6. Fluxo Caixa
    await client.query(`
      CREATE TABLE IF NOT EXISTS fluxo_caixa (
        id SERIAL PRIMARY KEY,
        agendamento_id INT REFERENCES agendamentos(id) ON DELETE SET NULL,
        profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL,
        tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada', 'saida')),
        descricao VARCHAR(255) NOT NULL,
        valor DECIMAL(10, 2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pago',
        forma_pagamento VARCHAR(50) DEFAULT 'pix',
        data_movimento DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 7. Estoque Produtos
    await client.query(`
      CREATE TABLE IF NOT EXISTS estoque_produtos (
        id SERIAL PRIMARY KEY,
        profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL,
        nome VARCHAR(120) NOT NULL,
        tipo VARCHAR(30) DEFAULT 'consumo',
        quantidade INT NOT NULL DEFAULT 0,
        estoque_minimo INT DEFAULT 1,
        custo_unitario DECIMAL(10, 2) DEFAULT 0.00,
        imagem_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 8. Estoque Movimentacoes
    await client.query(`
      CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
        id SERIAL PRIMARY KEY,
        produto_id INT REFERENCES estoque_produtos(id) ON DELETE CASCADE,
        profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL,
        tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
        quantidade INT NOT NULL,
        motivo TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 9. Servico Produtos (Vinculo Estoque x Servico)
    await client.query(`
      CREATE TABLE IF NOT EXISTS servico_produtos (
        id SERIAL PRIMARY KEY,
        servico_id INT REFERENCES servicos(id) ON DELETE CASCADE,
        produto_id INT REFERENCES estoque_produtos(id) ON DELETE CASCADE,
        quantidade_usada INT DEFAULT 1
      );
    `);

    // 10. Configuracoes
    await client.query(`
      CREATE TABLE IF NOT EXISTS configuracoes (
        id SERIAL PRIMARY KEY,
        chave VARCHAR(100) UNIQUE NOT NULL,
        valor JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 11. Auditoria
    await client.query(`
      CREATE TABLE IF NOT EXISTS auditoria_operacoes (
        id SERIAL PRIMARY KEY,
        profissional_id INT,
        acao VARCHAR(50) NOT NULL,
        modulo VARCHAR(50) NOT NULL,
        detalhes JSONB,
        ip_origem VARCHAR(50),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    console.log(`[MIGRATION] Schema "${schemaName}" fully initialized.`);
  } finally {
    client.release();
  }
}
