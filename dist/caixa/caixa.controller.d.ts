import { CaixaService } from './caixa.service';
export declare class CaixaController {
    private readonly caixaService;
    constructor(caixaService: CaixaService);
    findAll(req: any, query: any): Promise<{
        movimentacoes: any;
        resumo: {
            totalEntradas: number;
            totalSaidas: number;
            saldo: number;
        };
    }>;
    create(req: any, body: any): Promise<{
        movimentacao: any;
    }>;
    remove(req: any, id: string): Promise<{
        message: string;
    }>;
}
