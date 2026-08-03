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
exports.AgendamentosService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let AgendamentosService = class AgendamentosService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(tenantSlug, query) {
        const { data_inicio, data_fim, status, profissional_id } = query;
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            let sql = `
        SELECT a.*,
               c.nome as cliente_nome, c.whatsapp as cliente_whatsapp,
               p.nome as profissional_nome,
               s.nome as servico_nome
        FROM agendamentos a
        LEFT JOIN clientes c ON a.cliente_id = c.id
        LEFT JOIN profissionais p ON a.profissional_id = p.id
        LEFT JOIN servicos s ON a.servico_id = s.id
        WHERE 1=1
      `;
            const params = [];
            if (data_inicio) {
                params.push(data_inicio);
                sql += ` AND a.data_hora >= $${params.length}`;
            }
            if (data_fim) {
                params.push(data_fim);
                sql += ` AND a.data_hora <= $${params.length}`;
            }
            if (status) {
                params.push(status);
                sql += ` AND a.status = $${params.length}`;
            }
            if (profissional_id) {
                params.push(profissional_id);
                sql += ` AND a.profissional_id = $${params.length}`;
            }
            sql += ' ORDER BY a.data_hora ASC';
            const agendamentos = await this.prisma.$queryRawUnsafe(sql, ...params);
            return { agendamentos };
        });
    }
    async create(tenantSlug, user, dto) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const { cliente_id, profissional_id, servico_id, subservico_id, data_hora, valor_total, observacao, tipo_atendimento, endereco_externo, status } = dto;
            const res = await this.prisma.$queryRawUnsafe(`INSERT INTO agendamentos (
          cliente_id, profissional_id, servico_id, subservico_id,
          data_hora, valor_total, observacao, tipo_atendimento, endereco_externo, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, cliente_id || null, profissional_id || user.profissional_id, servico_id, subservico_id || null, data_hora, valor_total || 0, observacao || null, tipo_atendimento || 'salao', endereco_externo || null, status || 'agendado');
            return { agendamento: res[0] };
        });
    }
    async update(tenantSlug, id, dto) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const { status, data_hora, valor_total, observacao } = dto;
            const res = await this.prisma.$queryRawUnsafe(`UPDATE agendamentos
         SET status = COALESCE($1, status),
             data_hora = COALESCE($2, data_hora),
             valor_total = COALESCE($3, valor_total),
             observacao = COALESCE($4, observacao)
         WHERE id = $5 RETURNING *`, status, data_hora, valor_total, observacao, id);
            if (!res || res.length === 0)
                throw new common_1.NotFoundException('Appointment not found.');
            return { agendamento: res[0] };
        });
    }
    async remove(tenantSlug, id) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const res = await this.prisma.$queryRawUnsafe('DELETE FROM agendamentos WHERE id = $1 RETURNING id', id);
            if (!res || res.length === 0)
                throw new common_1.NotFoundException('Appointment not found.');
            return { message: 'Appointment deleted successfully.' };
        });
    }
};
exports.AgendamentosService = AgendamentosService;
exports.AgendamentosService = AgendamentosService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AgendamentosService);
//# sourceMappingURL=agendamentos.service.js.map