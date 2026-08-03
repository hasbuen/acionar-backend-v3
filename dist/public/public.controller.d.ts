import { PublicService } from './public.service';
export declare class PublicController {
    private readonly publicService;
    constructor(publicService: PublicService);
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
    createPublicAppointment(slug: string, body: any): Promise<{
        message: string;
        agendamento: any;
    }>;
}
