import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'async_hooks';

const tenantStorage = new AsyncLocalStorage<PrismaClient>();

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private tenantClients = new Map<string, PrismaClient>();

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    for (const client of this.tenantClients.values()) {
      await client.$disconnect();
    }
  }

  getTenantSchemaName(slug: string): string {
    const safeSlug = (slug || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^[^a-z_]/, 't_$');
    return `tenant_${safeSlug}`;
  }

  /**
   * Retorna a URL de conexão específica do banco de dados do tenant
   */
  getTenantDbUrl(slug: string): string {
    const safeSlug = (slug || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, '_');
    
    const baseUrl = process.env.DATABASE_URL || 'postgresql://acionar:Bu1v742G36K850@localhost:5432/acionar_v3';
    
    try {
      const url = new URL(baseUrl);
      url.pathname = `/tenant_${safeSlug}`;
      return url.toString();
    } catch (e) {
      return baseUrl.replace(/\/acionar_v3(\?|$)/, `/tenant_${safeSlug}$1`);
    }
  }

  /**
   * Obtém ou inicializa a conexão PrismaClient para o banco específico do tenant
   */
  getTenantClient(slug: string): PrismaClient {
    const safeSlug = (slug || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, '_');

    let client = this.tenantClients.get(safeSlug);
    if (!client) {
      const connectionString = this.getTenantDbUrl(safeSlug);
      client = new PrismaClient({
        datasources: {
          db: {
            url: connectionString,
          },
        },
      });
      this.tenantClients.set(safeSlug, client);
    }
    return client;
  }

  /**
   * Sobrescreve $queryRawUnsafe para delegar ao tenant ativo no AsyncLocalStorage
   */
  override $queryRawUnsafe<T = any>(query: string, ...values: any[]): Prisma.PrismaPromise<T> {
    const tenantClient = tenantStorage.getStore();
    if (tenantClient) {
      return tenantClient.$queryRawUnsafe<T>(query, ...values);
    }
    return super.$queryRawUnsafe<T>(query, ...values);
  }

  /**
   * Sobrescreve $executeRawUnsafe para delegar ao tenant ativo no AsyncLocalStorage
   */
  override $executeRawUnsafe(query: string, ...values: any[]): Prisma.PrismaPromise<number> {
    const tenantClient = tenantStorage.getStore();
    if (tenantClient) {
      return tenantClient.$executeRawUnsafe(query, ...values);
    }
    return super.$executeRawUnsafe(query, ...values);
  }

  /**
   * Helper to run queries inside a specific tenant database context using AsyncLocalStorage
   */
  async runInTenantSchema<T>(slug: string, callback: () => Promise<T>): Promise<T> {
    const tenantClient = this.getTenantClient(slug);
    
    return tenantStorage.run(tenantClient, async () => {
      return await callback();
    });
  }

  /**
   * Garante a criação do banco de dados físico do tenant e migra a estrutura das tabelas
   */
  async ensureTenantSchema(slug: string): Promise<void> {
    const safeSlug = (slug || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]/g, '_');
    const dbName = `tenant_${safeSlug}`;

    // 1. Tentar criar o banco de dados físico se ele não existir
    try {
      const result: any = await super.$queryRawUnsafe(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        dbName
      );
      if (!result || result.length === 0) {
        await super.$executeRawUnsafe(`CREATE DATABASE "${dbName}";`);
        console.log(`[DATABASE MULTI-TENANT] Banco de dados de tenant criado com sucesso: ${dbName}`);
      }
    } catch (err) {
      // Ignorar erros comuns, ex.: banco de dados já existente
      console.warn(`[DATABASE MULTI-TENANT] Verificação/Criação do banco ${dbName} disparou aviso:`, err.message);
    }

    // 2. Conectar no banco do tenant e migrar as tabelas
    const tenantClient = this.getTenantClient(safeSlug);

    try {
      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS profissionais (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(100) NOT NULL,
          email VARCHAR(120) UNIQUE NOT NULL,
          telefone VARCHAR(30),
          cargo VARCHAR(30) DEFAULT 'auxiliar',
          foto_url TEXT,
          ativo BOOLEAN DEFAULT true,
          senha_hash TEXT,
          cor_identificadora VARCHAR(20) DEFAULT '#8c52ff',
          aceita_atendimento_externo BOOLEAN DEFAULT false,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE profissionais ADD COLUMN IF NOT EXISTS cor_identificadora VARCHAR(20) DEFAULT '#8c52ff';
      `);

      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE profissionais ADD COLUMN IF NOT EXISTS aceita_atendimento_externo BOOLEAN DEFAULT false;
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS servicos (
          id SERIAL PRIMARY KEY,
          nome VARCHAR(100) NOT NULL,
          descricao TEXT,
          duracao_minutos INT DEFAULT 60,
          preco DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
          foto_url TEXT,
          ativo BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS subservicos (
          id SERIAL PRIMARY KEY,
          servico_id INT REFERENCES servicos(id) ON DELETE CASCADE,
          nome VARCHAR(100) NOT NULL,
          duracao_adicional_minutos INT DEFAULT 0,
          preco_adicional DECIMAL(10, 2) DEFAULT 0.00,
          foto_url TEXT,
          ativo BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE servicos ADD COLUMN IF NOT EXISTS foto_url TEXT;
      `);

      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE subservicos ADD COLUMN IF NOT EXISTS foto_url TEXT;
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS clientes (
          id SERIAL PRIMARY KEY,
          profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL,
          nome VARCHAR(100) NOT NULL,
          whatsapp VARCHAR(30),
          email VARCHAR(120),
          observacoes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE clientes ADD COLUMN IF NOT EXISTS profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL;
      `);


      await tenantClient.$executeRawUnsafe(`
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

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS fluxo_caixa (
          id SERIAL PRIMARY KEY,
          agendamento_id INT REFERENCES agendamentos(id) ON DELETE SET NULL,
          profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL,
          cliente_id INT REFERENCES clientes(id) ON DELETE SET NULL,
          tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('entrada', 'saida')),
          categoria VARCHAR(50) DEFAULT NULL,
          descricao VARCHAR(255) NOT NULL,
          valor DECIMAL(10, 2) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pago',
          forma_pagamento VARCHAR(50) DEFAULT 'pix',
          data_movimento DATE DEFAULT CURRENT_DATE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Migração segura: adiciona colunas em bancos já existentes
      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE fluxo_caixa ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT NULL;
      `);
      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE fluxo_caixa ADD COLUMN IF NOT EXISTS cliente_id INT REFERENCES clientes(id) ON DELETE SET NULL;
      `);

      await tenantClient.$executeRawUnsafe(`
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

      await tenantClient.$executeRawUnsafe(`
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

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS configuracoes (
          chave VARCHAR(100) PRIMARY KEY,
          valor JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS servico_produtos (
          servico_id INT REFERENCES servicos(id) ON DELETE CASCADE,
          produto_id INT REFERENCES estoque_produtos(id) ON DELETE CASCADE,
          quantidade_usada DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
          PRIMARY KEY (servico_id, produto_id)
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS subservico_produtos (
          subservico_id INT REFERENCES subservicos(id) ON DELETE CASCADE,
          produto_id INT REFERENCES estoque_produtos(id) ON DELETE CASCADE,
          quantidade_usada DECIMAL(10, 2) NOT NULL DEFAULT 1.00,
          PRIMARY KEY (subservico_id, produto_id)
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS profissional_servicos (
          profissional_id INT REFERENCES profissionais(id) ON DELETE CASCADE,
          servico_id INT REFERENCES servicos(id) ON DELETE CASCADE,
          ativo BOOLEAN DEFAULT true,
          PRIMARY KEY (profissional_id, servico_id)
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS profissional_subservicos (
          profissional_id INT REFERENCES profissionais(id) ON DELETE CASCADE,
          subservico_id INT REFERENCES subservicos(id) ON DELETE CASCADE,
          ativo BOOLEAN DEFAULT true,
          PRIMARY KEY (profissional_id, subservico_id)
        );
      `);

      // Migração de profissional_id em servicos e subservicos
      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE servicos ADD COLUMN IF NOT EXISTS profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL;
      `);

      await tenantClient.$executeRawUnsafe(`
        ALTER TABLE subservicos ADD COLUMN IF NOT EXISTS profissional_id INT REFERENCES profissionais(id) ON DELETE SET NULL;
      `);

      // Migração retroativa de registros NULL para o proprietário do tenant
      await tenantClient.$executeRawUnsafe(`
        UPDATE clientes SET profissional_id = (SELECT id FROM profissionais WHERE cargo = 'proprietario' LIMIT 1) WHERE profissional_id IS NULL;
      `);

      await tenantClient.$executeRawUnsafe(`
        UPDATE servicos SET profissional_id = (SELECT id FROM profissionais WHERE cargo = 'proprietario' LIMIT 1) WHERE profissional_id IS NULL;
      `);

      await tenantClient.$executeRawUnsafe(`
        UPDATE subservicos SET profissional_id = (SELECT id FROM profissionais WHERE cargo = 'proprietario' LIMIT 1) WHERE profissional_id IS NULL;
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id SERIAL PRIMARY KEY,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT,
          auth TEXT,
          profissional_id INT REFERENCES profissionais(id) ON DELETE CASCADE,
          user_agent TEXT,
          plataforma TEXT,
          ativo BOOLEAN NOT NULL DEFAULT true,
          criado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profissional 
        ON push_subscriptions (profissional_id) 
        WHERE ativo = true;
      `);

      await tenantClient.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS avaliacoes (
          id SERIAL PRIMARY KEY,
          agendamento_id INT UNIQUE NOT NULL REFERENCES agendamentos(id) ON DELETE CASCADE,
          nota INT NOT NULL CHECK (nota >= 1 AND nota <= 5),
          comentario VARCHAR(500),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);


    } catch (err) {
      console.error(`[DATABASE MULTI-TENANT] Falha crítica de migração DDL no banco ${dbName}:`, err.message);
    }
  }
}

