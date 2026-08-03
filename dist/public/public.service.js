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
exports.PublicService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let PublicService = class PublicService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getTenantPublicInfo(slug) {
        const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
        const tenant = await this.prisma.tenant.findUnique({
            where: { slug: cleanSlug },
            select: {
                slug: true,
                nome_empresa: true,
                foto_url: true,
                cor_primaria: true,
                cor_destaque: true,
                cor_fundo: true,
                agenda_publica_ativa: true,
            },
        });
        if (!tenant)
            throw new common_1.NotFoundException('Establishment not found.');
        return { tenant };
    }
    async getPublicServices(slug) {
        const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
        await this.prisma.ensureTenantSchema(cleanSlug);
        return this.prisma.runInTenantSchema(cleanSlug, async () => {
            const servicos = await this.prisma.$queryRawUnsafe('SELECT * FROM servicos WHERE ativo = true ORDER BY nome ASC');
            const subservicos = await this.prisma.$queryRawUnsafe('SELECT * FROM subservicos WHERE ativo = true ORDER BY nome ASC');
            const result = servicos.map(s => ({
                ...s,
                subservicos: subservicos.filter(sub => sub.servico_id === s.id),
            }));
            return { servicos: result };
        });
    }
    async getPublicProfessionals(slug) {
        const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
        await this.prisma.ensureTenantSchema(cleanSlug);
        return this.prisma.runInTenantSchema(cleanSlug, async () => {
            const profissionais = await this.prisma.$queryRawUnsafe('SELECT id, nome, foto_url, cargo FROM profissionais WHERE ativo = true ORDER BY nome ASC');
            return { profissionais };
        });
    }
    async createPublicAppointment(slug, dto) {
        const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
        const tenant = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
        if (!tenant)
            throw new common_1.NotFoundException('Tenant not found.');
        if (!tenant.agenda_publica_ativa) {
            throw new common_1.ForbiddenException('Public online scheduling is currently closed for this establishment.');
        }
        await this.prisma.ensureTenantSchema(cleanSlug);
        const { cliente_nome, cliente_whatsapp, cliente_email, profissional_id, servico_id, subservico_id, data_hora, observacao, tipo_atendimento, endereco_externo, } = dto;
        if (!cliente_nome || !cliente_whatsapp || !servico_id || !data_hora) {
            throw new common_1.BadRequestException('Name, WhatsApp, Service, and Date/Time are required.');
        }
        return this.prisma.runInTenantSchema(cleanSlug, async () => {
            const existing = await this.prisma.$queryRawUnsafe('SELECT id FROM clientes WHERE whatsapp = $1 OR (email IS NOT NULL AND email = $2) LIMIT 1', cliente_whatsapp, cliente_email || '');
            let clienteId;
            if (existing && existing.length > 0) {
                clienteId = existing[0].id;
            }
            else {
                const newC = await this.prisma.$queryRawUnsafe('INSERT INTO clientes (nome, whatsapp, email) VALUES ($1, $2, $3) RETURNING id', cliente_nome, cliente_whatsapp, cliente_email || null);
                clienteId = newC[0].id;
            }
            const servRes = await this.prisma.$queryRawUnsafe('SELECT preco, duracao_minutos FROM servicos WHERE id = $1', servico_id);
            if (!servRes || servRes.length === 0)
                throw new common_1.NotFoundException('Service not found.');
            let valorTotal = parseFloat(servRes[0].preco || 0);
            let duracaoTotal = parseInt(servRes[0].duracao_minutos || 60, 10);
            if (subservico_id) {
                const subRes = await this.prisma.$queryRawUnsafe('SELECT preco_adicional, duracao_adicional_minutos FROM subservicos WHERE id = $1', subservico_id);
                if (subRes && subRes.length > 0) {
                    valorTotal += parseFloat(subRes[0].preco_adicional || 0);
                    duracaoTotal += parseInt(subRes[0].duracao_adicional_minutos || 0, 10);
                }
            }
            const apptRes = await this.prisma.$queryRawUnsafe(`INSERT INTO agendamentos (
          cliente_id, profissional_id, servico_id, subservico_id, data_hora,
          duracao_total_minutos, valor_total, status, observacao, tipo_atendimento, endereco_externo
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'aguardando_confirmacao', $8, $9, $10)
        RETURNING *`, clienteId, profissional_id || null, servico_id, subservico_id || null, data_hora, duracaoTotal, valorTotal, observacao || 'Agendado via Agenda Pública', tipo_atendimento || 'salao', endereco_externo || null);
            return {
                message: 'Appointment requested successfully.',
                agendamento: apptRes[0],
            };
        });
    }
};
exports.PublicService = PublicService;
exports.PublicService = PublicService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PublicService);
//# sourceMappingURL=public.service.js.map