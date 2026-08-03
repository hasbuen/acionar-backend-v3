import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
export declare class AuthService {
    private readonly prisma;
    private readonly jwtService;
    constructor(prisma: PrismaService, jwtService: JwtService);
    registerTenant(dto: any): Promise<{
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
    login(dto: any): Promise<{
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
    me(payload: any): Promise<{
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
