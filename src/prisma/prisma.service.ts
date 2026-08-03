import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
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
   * Helper to run queries inside a specific tenant schema
   */
  async runInTenantSchema<T>(slug: string, callback: (prisma: PrismaClient) => Promise<T>): Promise<T> {
    const schemaName = this.getTenantSchemaName(slug);
    await this.$executeRawUnsafe(`SET search_path TO "${schemaName}", public;`);
    try {
      return await callback(this);
    } finally {
      await this.$executeRawUnsafe(`SET search_path TO public;`);
    }
  }

  /**
   * Initialize tenant schema & tables dynamically
   */
  async ensureTenantSchema(slug: string): Promise<void> {
    const schemaName = this.getTenantSchemaName(slug);
    await this.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
    await this.$executeRawUnsafe(`SET search_path TO "${schemaName}", public;`);

    // Tables in tenant schema
    await this.$executeRawUnsafe(`
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
      CREATE TABLE IF NOT EXISTS servicos (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        descricao TEXT,
        duracao_minutos INT DEFAULT 60,
        preco DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS subservicos (
        id SERIAL PRIMARY KEY,
        servico_id INT REFERENCES servicos(id) ON DELETE CASCADE,
        nome VARCHAR(100) NOT NULL,
        duracao_adicional_minutos INT DEFAULT 0,
        preco_adicional DECIMAL(10, 2) DEFAULT 0.00,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        whatsapp VARCHAR(30),
        email VARCHAR(120),
        observacoes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
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

    await this.$executeRawUnsafe(`SET search_path TO public;`);
  }
}
