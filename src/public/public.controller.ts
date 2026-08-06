import { Controller, Get, Post, Param, Body } from '@nestjs/common';
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

  @Post('asaas-webhook')
  async handleAsaasWebhook(@Body() body: any) {
    return this.publicService.handleAsaasWebhook(body);
  }
}
