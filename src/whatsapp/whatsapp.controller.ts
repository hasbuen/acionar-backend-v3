import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('status')
  async getStatus(@Req() req: any) {
    return this.whatsappService.getStatus(req.user.tenant_slug);
  }

  @Get('connect')
  async connect(@Req() req: any) {
    return this.whatsappService.connect(req.user.tenant_slug);
  }

  @Post('disconnect')
  async disconnect(@Req() req: any) {
    return this.whatsappService.disconnect(req.user.tenant_slug);
  }
}
