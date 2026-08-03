import { PrismaService } from '../prisma/prisma.service';
export declare class ServicosService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(tenantSlug: string): Promise<{
        servicos: any;
    }>;
    create(tenantSlug: string, dto: any): Promise<{
        servico: any;
    }>;
    update(tenantSlug: string, id: number, dto: any): Promise<{
        servico: any;
    }>;
}
