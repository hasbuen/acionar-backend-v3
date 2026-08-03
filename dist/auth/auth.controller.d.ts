import { AuthService } from './auth.service';
export declare class AuthController {
    private readonly authService;
    constructor(authService: AuthService);
    registerTenant(body: any): Promise<{
        message: string;
        token: string;
        tenant: {
            slug: string;
            nome_empresa: string;
            email_proprietario: string;
            telefone: string | null;
            foto_url: string | null;
            cor_primaria: string;
            id: number;
            senha_hash: string;
            status: string;
            cor_destaque: string;
            cor_fundo: string;
            agenda_publica_ativa: boolean;
            created_at: Date;
            updated_at: Date;
        };
        user: any;
    }>;
    login(body: any): Promise<{
        token: string;
        tenant: {
            slug: string;
            nome_empresa: string;
            email_proprietario: string;
            telefone: string | null;
            foto_url: string | null;
            cor_primaria: string;
            id: number;
            senha_hash: string;
            status: string;
            cor_destaque: string;
            cor_fundo: string;
            agenda_publica_ativa: boolean;
            created_at: Date;
            updated_at: Date;
        };
        user: any;
    }>;
    me(req: any): Promise<{
        tenant: {
            slug: string;
            nome_empresa: string;
            email_proprietario: string;
            telefone: string | null;
            foto_url: string | null;
            cor_primaria: string;
            id: number;
            senha_hash: string;
            status: string;
            cor_destaque: string;
            cor_fundo: string;
            agenda_publica_ativa: boolean;
            created_at: Date;
            updated_at: Date;
        };
        user: any;
    }>;
}
