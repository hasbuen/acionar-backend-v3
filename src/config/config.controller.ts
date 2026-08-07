import { Controller, Get, Put, Post, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ConfigService } from './config.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/config')
@UseGuards(JwtAuthGuard)
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get('public-schedule')
  async getPublicScheduleConfig(@Req() req: any) {
    return this.configService.getPublicScheduleConfig(req.user.tenant_slug);
  }

  @Get('payments')
  async getPaymentConfig(@Req() req: any) {
    return this.configService.getPaymentConfig(req.user.tenant_slug);
  }

  @Put('payments')
  async updatePaymentConfig(@Req() req: any, @Body() body: any) {
    if (req.user.cargo === 'auxiliar') {
      throw new ForbiddenException('Acesso negado.');
    }
    return this.configService.updatePaymentConfig(req.user.tenant_slug, body);
  }

  @Put('public-schedule')
  async updatePublicScheduleConfig(@Req() req: any, @Body() body: any) {
    if (req.user.cargo === 'auxiliar') {
      throw new ForbiddenException('Acesso negado.');
    }
    return this.configService.updatePublicScheduleConfig(req.user.tenant_slug, body);
  }

  @Get('messages')
  async getMessageConfig(@Req() req: any) {
    return this.configService.getMessageConfig(req.user.tenant_slug);
  }

  @Put('messages')
  async updateMessageConfig(@Req() req: any, @Body() body: any) {
    if (req.user.cargo === 'auxiliar') {
      throw new ForbiddenException('Acesso negado.');
    }
    return this.configService.updateMessageConfig(req.user.tenant_slug, body);
  }

  @Post('upload-logo')
  async uploadLogo(@Req() req: any, @Body() body: { imageBase64: string }) {
    if (req.user.cargo === 'auxiliar') {
      throw new ForbiddenException('Acesso negado.');
    }
    return this.configService.uploadLogo(req.user.tenant_slug, body.imageBase64);
  }

  @Post('upload-image')
  async uploadImage(
    @Req() req: any,
    @Body() body: { type: 'servicos' | 'subservicos' | 'produtos'; imageBase64: string }
  ) {
    return this.configService.uploadImage(req.user.tenant_slug, body.type, body.imageBase64);
  }
}

