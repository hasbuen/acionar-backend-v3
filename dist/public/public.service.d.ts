import { PrismaService } from '../prisma/prisma.service';
export declare class PublicService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getTenantPublicInfo(slug: string): Promise<{
        tenant: {
            slug: string;
            nome_empresa: string;
            foto_url: string;
            cor_primaria: string;
            cor_destaque: string;
            cor_fundo: string;
            agenda_publica_ativa: boolean;
        };
    }>;
    getPublicServices(slug: string): Promise<{
        servicos: any;
    }>;
    getPublicProfessionals(slug: string): Promise<{
        profissionais: any;
    }>;
    createPublicAppointment(slug: string, dto: any): Promise<{
        message: string;
        agendamento: any;
    }>;
}
