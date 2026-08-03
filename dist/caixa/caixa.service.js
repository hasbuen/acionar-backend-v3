"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CaixaService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let CaixaService = class CaixaService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(tenantSlug, query) {
        const { data_inicio, data_fim } = query;
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            let sql = 'SELECT * FROM fluxo_caixa WHERE 1=1';
            const params = [];
            if (data_inicio) {
                params.push(data_inicio);
                sql += ` AND data_movimento >= $${params.length}`;
            }
            if (data_fim) {
                params.push(data_fim);
                sql += ` AND data_movimento <= $${params.length}`;
            }
            sql += ' ORDER BY data_movimento DESC, id DESC';
            const movimentacoes = await this.prisma.$queryRawUnsafe(sql, ...params);
            let totalEntradas = 0;
            let totalSaidas = 0;
            movimentacoes.forEach(item => {
                const val = parseFloat(item.valor || 0);
                if (item.tipo === 'entrada' && item.status === 'pago')
                    totalEntradas += val;
                if (item.tipo === 'saida' && item.status === 'pago')
                    totalSaidas += val;
            });
            return {
                movimentacoes,
                resumo: {
                    totalEntradas: Math.round(totalEntradas * 100) / 100,
                    totalSaidas: Math.round(totalSaidas * 100) / 100,
                    saldo: Math.round((totalEntradas - totalSaidas) * 100) / 100,
                },
            };
        });
    }
    async create(tenantSlug, user, dto) {
        const { agendamento_id, tipo, descricao, valor, status, forma_pagamento, data_movimento } = dto;
        if (!tipo || !descricao || valor === undefined) {
            throw new common_1.BadRequestException('Type, Description, and Value are required.');
        }
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const res = await this.prisma.$queryRawUnsafe(`INSERT INTO fluxo_caixa (
          agendamento_id, profissional_id, tipo, descricao, valor, status, forma_pagamento, data_movimento
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, agendamento_id || null, user.profissional_id, tipo, descricao, valor, status || 'pago', forma_pagamento || 'pix', data_movimento || new Date().toISOString().split('T')[0]);
            return { movimentacao: res[0] };
        });
    }
    async remove(tenantSlug, id) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const res = await this.prisma.$queryRawUnsafe('DELETE FROM fluxo_caixa WHERE id = $1 RETURNING id', id);
            if (!res || res.length === 0)
                throw new common_1.NotFoundException('Cashflow entry not found.');
            return { message: 'Cashflow entry deleted successfully.' };
        });
    }
};
exports.CaixaService = CaixaService;
exports.CaixaService = CaixaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CaixaService);
//# sourceMappingURL=caixa.service.js.map