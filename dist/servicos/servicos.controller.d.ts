import { ServicosService } from './servicos.service';
export declare class ServicosController {
    private readonly servicosService;
    constructor(servicosService: ServicosService);
    findAll(req: any): Promise<{
        servicos: any;
    }>;
    create(req: any, body: any): Promise<{
        servico: any;
    }>;
    update(req: any, id: string, body: any): Promise<{
        servico: any;
    }>;
}
