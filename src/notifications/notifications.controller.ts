import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('public-key')
  async getPublicKey() {
    return this.notificationsService.getPublicKey();
  }

  @Post('subscribe')
  @UseGuards(JwtAuthGuard)
  async subscribe(@Req() req: any, @Body() body: any) {
    return this.notificationsService.subscribe(req.user.tenant_slug, req.user, body);
  }

  @Post('unsubscribe')
  @UseGuards(JwtAuthGuard)
  async unsubscribe(@Req() req: any, @Body() body: any) {
    return this.notificationsService.unsubscribe(req.user.tenant_slug, body);
  }
}
