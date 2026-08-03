import { PrismaService } from '../prisma/prisma.service';
export declare class EstoqueService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findProdutos(tenantSlug: string): Promise<{
        produtos: any;
    }>;
    createProduto(tenantSlug: string, user: any, dto: any): Promise<{
        produto: any;
    }>;
    createMovimentacao(tenantSlug: string, user: any, dto: any): Promise<{
        message: string;
        movimentacao: any;
        nova_quantidade: number;
    }>;
}
