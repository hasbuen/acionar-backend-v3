"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
let PrismaService = class PrismaService extends client_1.PrismaClient {
    async onModuleInit() {
        await this.$connect();
    }
    async onModuleDestroy() {
        await this.$disconnect();
    }
    getTenantSchemaName(slug) {
        const safeSlug = (slug || '')
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^[^a-z_]/, 't_$');
        return `tenant_${safeSlug}`;
    }
    async runInTenantSchema(slug, callback) {
        const schemaName = this.getTenantSchemaName(slug);
        await this.$executeRawUnsafe(`SET search_path TO "${schemaName}", public;`);
        try {
            return await callback(this);
        }
        finally {
            await this.$executeRawUnsafe(`SET search_path TO public;`);
        }
    }
    async ensureTenantSchema(slug) {
        const schemaName = this.getTenantSchemaName(slug);
        await this.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`);
        await this.$executeRawUnsafe(`SET search_path TO "${schemaName}", public;`);
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
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = __decorate([
    (0, common_1.Injectable)()
], PrismaService);
//# sourceMappingURL=prisma.service.js.map