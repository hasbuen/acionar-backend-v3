import { PrismaService } from '../prisma/prisma.service';
export declare class ClientesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(tenantSlug: string): Promise<{
        clientes: any;
    }>;
    create(tenantSlug: string, dto: any): Promise<{
        cliente: any;
    }>;
    update(tenantSlug: string, id: number, dto: any): Promise<{
        cliente: any;
    }>;
}
