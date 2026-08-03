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
exports.ServicosService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ServicosService = class ServicosService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(tenantSlug) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const servicos = await this.prisma.$queryRawUnsafe('SELECT * FROM servicos ORDER BY nome ASC');
            const subservicos = await this.prisma.$queryRawUnsafe('SELECT * FROM subservicos ORDER BY nome ASC');
            const result = servicos.map(s => ({
                ...s,
                subservicos: subservicos.filter(sub => sub.servico_id === s.id),
            }));
            return { servicos: result };
        });
    }
    async create(tenantSlug, dto) {
        const { nome, descricao, duracao_minutos, preco, ativo } = dto;
        if (!nome || preco === undefined)
            throw new common_1.BadRequestException('Name and Price are required.');
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const res = await this.prisma.$queryRawUnsafe(`INSERT INTO servicos (nome, descricao, duracao_minutos, preco, ativo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`, nome, descricao || null, duracao_minutos || 60, preco, ativo !== undefined ? ativo : true);
            return { servico: res[0] };
        });
    }
    async update(tenantSlug, id, dto) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const { nome, descricao, duracao_minutos, preco, ativo } = dto;
            const res = await this.prisma.$queryRawUnsafe(`UPDATE servicos
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             duracao_minutos = COALESCE($3, duracao_minutos),
             preco = COALESCE($4, preco),
             ativo = COALESCE($5, ativo)
         WHERE id = $6 RETURNING *`, nome, descricao, duracao_minutos, preco, ativo, id);
            if (!res || res.length === 0)
                throw new common_1.NotFoundException('Service not found.');
            return { servico: res[0] };
        });
    }
};
exports.ServicosService = ServicosService;
exports.ServicosService = ServicosService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ServicosService);
//# sourceMappingURL=servicos.service.js.map