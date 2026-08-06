import { Controller, Get, Post, Put, Delete, Body, Req, Param, UseGuards } from '@nestjs/common';
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

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Req() req: any) {
    return this.notificationsService.findAll(req.user.tenant_slug, req.user);
  }

  @Put(':id/read')
  @UseGuards(JwtAuthGuard)
  async markAsRead(@Req() req: any, @Param('id') id: string) {
    return this.notificationsService.markAsRead(req.user.tenant_slug, parseInt(id, 10), req.user);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  async clearAll(@Req() req: any) {
    return this.notificationsService.clearAll(req.user.tenant_slug, req.user);
  }
}
