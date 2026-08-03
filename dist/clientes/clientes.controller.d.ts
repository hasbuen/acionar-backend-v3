import { ClientesService } from './clientes.service';
export declare class ClientesController {
    private readonly clientesService;
    constructor(clientesService: ClientesService);
    findAll(req: any): Promise<{
        clientes: any;
    }>;
    create(req: any, body: any): Promise<{
        cliente: any;
    }>;
    update(req: any, id: string, body: any): Promise<{
        cliente: any;
    }>;
}
