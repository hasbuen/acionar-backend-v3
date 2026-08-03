import { ConfigService } from './config.service';
export declare class ConfigController {
    private readonly configService;
    constructor(configService: ConfigService);
    getPublicScheduleConfig(req: any): Promise<{
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
    updatePublicScheduleConfig(req: any, body: any): Promise<{
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
