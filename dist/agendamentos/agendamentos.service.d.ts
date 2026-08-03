import { PrismaService } from '../prisma/prisma.service';
export declare class AgendamentosService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(tenantSlug: string, query: any): Promise<{
        agendamentos: any;
    }>;
    create(tenantSlug: string, user: any, dto: any): Promise<{
        agendamento: any;
    }>;
    update(tenantSlug: string, id: number, dto: any): Promise<{
        agendamento: any;
    }>;
    remove(tenantSlug: string, id: number): Promise<{
        message: string;
    }>;
}
