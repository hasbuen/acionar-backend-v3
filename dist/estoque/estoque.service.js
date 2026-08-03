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
exports.EstoqueService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let EstoqueService = class EstoqueService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findProdutos(tenantSlug) {
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const produtos = await this.prisma.$queryRawUnsafe('SELECT * FROM estoque_produtos ORDER BY nome ASC');
            return { produtos };
        });
    }
    async createProduto(tenantSlug, user, dto) {
        const { nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url } = dto;
        if (!nome)
            throw new common_1.BadRequestException('Product name is required.');
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const res = await this.prisma.$queryRawUnsafe(`INSERT INTO estoque_produtos (
          profissional_id, nome, tipo, quantidade, estoque_minimo, custo_unitario, imagem_url
        ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, user.profissional_id, nome, tipo || 'consumo', quantidade || 0, estoque_minimo || 1, custo_unitario || 0, imagem_url || null);
            const produto = res[0];
            if (quantidade > 0) {
                await this.prisma.$queryRawUnsafe(`INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
           VALUES ($1, $2, 'entrada', $3, 'Estoque inicial cadastrado')`, produto.id, user.profissional_id, quantidade);
            }
            return { produto };
        });
    }
    async createMovimentacao(tenantSlug, user, dto) {
        const { produto_id, tipo, quantidade, motivo } = dto;
        if (!produto_id || !tipo || !quantidade) {
            throw new common_1.BadRequestException('Product ID, Type, and Quantity are required.');
        }
        const qtyNum = parseInt(quantidade, 10);
        await this.prisma.ensureTenantSchema(tenantSlug);
        return this.prisma.runInTenantSchema(tenantSlug, async () => {
            const prodRes = await this.prisma.$queryRawUnsafe('SELECT quantidade FROM estoque_produtos WHERE id = $1', produto_id);
            if (!prodRes || prodRes.length === 0)
                throw new common_1.NotFoundException('Product not found.');
            const currentQty = parseInt(prodRes[0].quantidade || 0, 10);
            let newQty = currentQty;
            if (tipo === 'entrada')
                newQty += qtyNum;
            else if (tipo === 'saida')
                newQty = Math.max(0, currentQty - qtyNum);
            else if (tipo === 'ajuste')
                newQty = qtyNum;
            await this.prisma.$queryRawUnsafe('UPDATE estoque_produtos SET quantidade = $1 WHERE id = $2', newQty, produto_id);
            const movRes = await this.prisma.$queryRawUnsafe(`INSERT INTO estoque_movimentacoes (produto_id, profissional_id, tipo, quantidade, motivo)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`, produto_id, user.profissional_id, tipo, qtyNum, motivo || null);
            return {
                message: 'Inventory movement recorded.',
                movimentacao: movRes[0],
                nova_quantidade: newQty,
            };
        });
    }
};
exports.EstoqueService = EstoqueService;
exports.EstoqueService = EstoqueService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], EstoqueService);
//# sourceMappingURL=estoque.service.js.map