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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = require("bcryptjs");
const prisma_service_1 = require("../prisma/prisma.service");
let AuthService = class AuthService {
    constructor(prisma, jwtService) {
        this.prisma = prisma;
        this.jwtService = jwtService;
    }
    async registerTenant(dto) {
        const { slug, nome_empresa, email_proprietario, senha, telefone, foto_url, cor_primaria } = dto;
        const cleanSlug = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
        const existing = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
        if (existing) {
            throw new common_1.ConflictException(`Slug '${cleanSlug}' is already registered.`);
        }
        const salt = await bcrypt.genSalt(10);
        const senha_hash = await bcrypt.hash(senha, salt);
        const tenant = await this.prisma.tenant.create({
            data: {
                slug: cleanSlug,
                nome_empresa,
                email_proprietario,
                telefone: telefone || null,
                senha_hash,
                foto_url: foto_url || null,
                cor_primaria: cor_primaria || '#0d9488',
            },
        });
        await this.prisma.ensureTenantSchema(cleanSlug);
        const owner = await this.prisma.runInTenantSchema(cleanSlug, async () => {
            const res = await this.prisma.$queryRawUnsafe(`INSERT INTO profissionais (nome, email, telefone, cargo, foto_url, senha_hash)
         VALUES ($1, $2, $3, 'proprietario', $4, $5) RETURNING id, nome, email, cargo`, nome_empresa, email_proprietario, telefone || null, foto_url || null, senha_hash);
            return res[0];
        });
        const token = this.jwtService.sign({
            tenant_slug: cleanSlug,
            profissional_id: owner.id,
            email: owner.email,
            cargo: owner.cargo,
        });
        return {
            message: 'Tenant registered successfully.',
            token,
            tenant,
            user: owner,
        };
    }
    async login(dto) {
        const { slug, email, senha } = dto;
        const cleanSlug = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
        const tenant = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
        if (!tenant) {
            throw new common_1.NotFoundException('Tenant not found.');
        }
        if (tenant.status !== 'ativo') {
            throw new common_1.ForbiddenException('Tenant is inactive.');
        }
        await this.prisma.ensureTenantSchema(cleanSlug);
        const users = await this.prisma.runInTenantSchema(cleanSlug, async () => {
            return await this.prisma.$queryRawUnsafe('SELECT id, nome, email, cargo, foto_url, senha_hash, ativo FROM profissionais WHERE email = $1', email.toLowerCase().trim());
        });
        if (!users || users.length === 0) {
            throw new common_1.UnauthorizedException('Invalid credentials.');
        }
        const user = users[0];
        if (!user.ativo) {
            throw new common_1.ForbiddenException('User account is inactive.');
        }
        const valid = await bcrypt.compare(senha, user.senha_hash);
        if (!valid) {
            throw new common_1.UnauthorizedException('Invalid credentials.');
        }
        const token = this.jwtService.sign({
            tenant_slug: cleanSlug,
            profissional_id: user.id,
            email: user.email,
            cargo: user.cargo,
        });
        delete user.senha_hash;
        return {
            token,
            tenant,
            user,
        };
    }
    async me(payload) {
        const { tenant_slug, email } = payload;
        const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenant_slug } });
        if (!tenant)
            throw new common_1.NotFoundException('Tenant not found.');
        const users = await this.prisma.runInTenantSchema(tenant_slug, async () => {
            return await this.prisma.$queryRawUnsafe('SELECT id, nome, email, telefone, cargo, foto_url, ativo FROM profissionais WHERE email = $1', email);
        });
        if (!users || users.length === 0)
            throw new common_1.NotFoundException('User profile not found.');
        return {
            tenant,
            user: users[0],
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService])
], AuthService);
//# sourceMappingURL=auth.service.js.map