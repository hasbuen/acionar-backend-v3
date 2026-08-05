import { Controller, Get, Post, Put, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AgendamentosService } from './agendamentos.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/agendamentos')
@UseGuards(JwtAuthGuard)
export class AgendamentosController {
  constructor(private readonly agendamentosService: AgendamentosService) {}

  @Get()
  async findAll(@Req() req: any, @Query() query: any) {
    return this.agendamentosService.findAll(req.user.tenant_slug, query);
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    return this.agendamentosService.create(req.user.tenant_slug, req.user, body);
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.agendamentosService.update(req.user.tenant_slug, parseInt(id, 10), body);
  }

  @Get(':id/payment')
  async getPayment(@Req() req: any, @Param('id') id: string) {
    return this.agendamentosService.getPaymentData(req.user.tenant_slug, parseInt(id, 10));
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.agendamentosService.remove(req.user.tenant_slug, parseInt(id, 10));
  }
}
