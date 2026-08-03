import { AgendamentosService } from './agendamentos.service';
export declare class AgendamentosController {
    private readonly agendamentosService;
    constructor(agendamentosService: AgendamentosService);
    findAll(req: any, query: any): Promise<{
        agendamentos: any;
    }>;
    create(req: any, body: any): Promise<{
        agendamento: any;
    }>;
    update(req: any, id: string, body: any): Promise<{
        agendamento: any;
    }>;
    remove(req: any, id: string): Promise<{
        message: string;
    }>;
}
