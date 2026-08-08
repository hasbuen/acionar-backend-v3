import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfissionaisService } from './profissionais.service';

@Controller('api/profissionais')
@UseGuards(JwtAuthGuard)
export class ProfissionaisController {
  constructor(private readonly profissionaisService: ProfissionaisService) {}

  @Get()
  findAll(@Req() req: any) {
    return this.profissionaisService.findAll(req.user.tenant_slug);
  }

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.profissionaisService.create(req.user.tenant_slug, body, req.user);
  }

  @Put(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.profissionaisService.update(req.user.tenant_slug, parseInt(id, 10), body, req.user);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.profissionaisService.remove(req.user.tenant_slug, parseInt(id, 10), req.user);
  }
}

