import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('api/public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('tenant/:slug')
  async getTenantPublicInfo(@Param('slug') slug: string) {
    return this.publicService.getTenantPublicInfo(slug);
  }

  @Get('tenant/:slug/servicos')
  async getPublicServices(@Param('slug') slug: string) {
    return this.publicService.getPublicServices(slug);
  }

  @Get('tenant/:slug/profissionais')
  async getPublicProfessionals(@Param('slug') slug: string) {
    return this.publicService.getPublicProfessionals(slug);
  }

  @Post('tenant/:slug/agendamentos')
  async createPublicAppointment(@Param('slug') slug: string, @Body() body: any) {
    return this.publicService.createPublicAppointment(slug, body);
  }

  @Post('tenant/:slug/agendamentos/:id/confirmar-rapido')
  async confirmQuickAppointment(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Query('cliente_nome') clienteNome?: string,
    @Query('whatsapp') whatsapp?: string,
  ) {
    return this.publicService.confirmQuickAppointment(slug, parseInt(id, 10), { clienteNome, whatsapp });
  }

  @Post('asaas-webhook')
  async handleAsaasWebhook(@Body() body: any) {
    return this.publicService.handleAsaasWebhook(body);
  }
}
