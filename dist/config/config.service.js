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
exports.ConfigService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ConfigService = class ConfigService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getPublicScheduleConfig(tenantSlug) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { slug: tenantSlug },
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
            throw new common_1.NotFoundException('Tenant not found.');
        return { settings: tenant };
    }
    async updatePublicScheduleConfig(tenantSlug, dto) {
        const { agenda_publica_ativa, foto_url, cor_primaria, cor_destaque, cor_fundo, novo_slug } = dto;
        let targetSlug = tenantSlug;
        if (novo_slug && novo_slug !== tenantSlug) {
            const cleanSlug = novo_slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
            const existing = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
            if (existing) {
                throw new common_1.ConflictException(`Slug '${cleanSlug}' is already taken.`);
            }
            targetSlug = cleanSlug;
        }
        const updated = await this.prisma.tenant.update({
            where: { slug: tenantSlug },
            data: {
                slug: targetSlug,
                agenda_publica_ativa: agenda_publica_ativa !== undefined ? agenda_publica_ativa : undefined,
                foto_url: foto_url !== undefined ? foto_url : undefined,
                cor_primaria: cor_primaria || undefined,
                cor_destaque: cor_destaque || undefined,
                cor_fundo: cor_fundo || undefined,
            },
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
        return {
            message: 'Public schedule configuration updated successfully.',
            settings: updated,
        };
    }
};
exports.ConfigService = ConfigService;
exports.ConfigService = ConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ConfigService);
//# sourceMappingURL=config.service.js.map