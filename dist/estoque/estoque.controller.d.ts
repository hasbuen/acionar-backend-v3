import { EstoqueService } from './estoque.service';
export declare class EstoqueController {
    private readonly estoqueService;
    constructor(estoqueService: EstoqueService);
    findProdutos(req: any): Promise<{
        produtos: any;
    }>;
    createProduto(req: any, body: any): Promise<{
        produto: any;
    }>;
    createMovimentacao(req: any, body: any): Promise<{
        message: string;
        movimentacao: any;
        nova_quantidade: number;
    }>;
}
