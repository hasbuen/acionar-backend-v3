import { PrismaService } from '../prisma/prisma.service';
export declare class CaixaService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(tenantSlug: string, query: any): Promise<{
        movimentacoes: any;
        resumo: {
            totalEntradas: number;
            totalSaidas: number;
            saldo: number;
        };
    }>;
    create(tenantSlug: string, user: any, dto: any): Promise<{
        movimentacao: any;
    }>;
    remove(tenantSlug: string, id: number): Promise<{
        message: string;
    }>;
}
