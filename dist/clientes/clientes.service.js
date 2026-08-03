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
exports.ClientesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let ClientesService = class ClientesService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(tenantSlug) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const clientes = await this.prisma.$queryRawUnsafe('SELECT * FROM clientes ORDER BY nome ASC');
            return { clientes };
        });
    }
    async create(tenantSlug, dto) {
        const { nome, whatsapp, email, observacoes } = dto;
        if (!nome)
            throw new common_1.BadRequestException('Client name is required.');
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const res = await this.prisma.$queryRawUnsafe('INSERT INTO clientes (nome, whatsapp, email, observacoes) VALUES ($1, $2, $3, $4) RETURNING *', nome, whatsapp || null, email || null, observacoes || null);
            return { cliente: res[0] };
        });
    }
    async update(tenantSlug, id, dto) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const { nome, whatsapp, email, observacoes } = dto;
            const res = await this.prisma.$queryRawUnsafe(`UPDATE clientes
         SET nome = COALESCE($1, nome),
             whatsapp = COALESCE($2, whatsapp),
             email = COALESCE($3, email),
             observacoes = COALESCE($4, observacoes)
         WHERE id = $5 RETURNING *`, nome, whatsapp, email, observacoes, id);
            if (!res || res.length === 0)
                throw new common_1.NotFoundException('Client not found.');
            return { cliente: res[0] };
        });
    }
};
exports.ClientesService = ClientesService;
exports.ClientesService = ClientesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ClientesService);
//# sourceMappingURL=clientes.service.js.map