import { Controller, Get, Post, Put, Body, Req, Param, UseGuards } from '@nestjs/common';
import { SuporteService } from './suporte.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/suporte')
export class SuporteController {
  constructor(private readonly suporteService: SuporteService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async createTicket(@Req() req: any, @Body() body: any) {
    return this.suporteService.createTicket(req.user.tenant_slug, req.user, body);
  }

  @Get('demandas')
  @UseGuards(JwtAuthGuard)
  async getDemandas(@Req() req: any) {
    // Se for proprietário/admin pode ver todos os chamados ou os do próprio tenant
    return this.suporteService.getAllTickets(req.user.cargo === 'proprietario' ? undefined : req.user.tenant_slug);
  }

  @Put('demandas/:id/status')
  @UseGuards(JwtAuthGuard)
  async updateStatus(@Param('id') id: string, @Body() body: { status: 'pendente' | 'em_atendimento' | 'concluido' }) {
    return this.suporteService.updateStatus(parseInt(id, 10), body.status);
  }
}
