import { Controller, Get, Put, Post, Body, Req, UseGuards } from '@nestjs/common';
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

  @Put('public-schedule')
  async updatePublicScheduleConfig(@Req() req: any, @Body() body: any) {
    return this.configService.updatePublicScheduleConfig(req.user.tenant_slug, body);
  }

  @Post('upload-logo')
  async uploadLogo(@Req() req: any, @Body() body: { imageBase64: string }) {
    return this.configService.uploadLogo(req.user.tenant_slug, body.imageBase64);
  }
}
