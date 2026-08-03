import { PrismaService } from '../prisma/prisma.service';
export declare class ConfigService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getPublicScheduleConfig(tenantSlug: string): Promise<{
        settings: {
            slug: string;
            nome_empresa: string;
            foto_url: string;
            cor_primaria: string;
            cor_destaque: string;
            cor_fundo: string;
            agenda_publica_ativa: boolean;
        };
    }>;
    updatePublicScheduleConfig(tenantSlug: string, dto: any): Promise<{
        message: string;
        settings: {
            slug: string;
            nome_empresa: string;
            foto_url: string;
            cor_primaria: string;
            cor_destaque: string;
            cor_fundo: string;
            agenda_publica_ativa: boolean;
        };
    }>;
}
