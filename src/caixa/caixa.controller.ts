import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { CaixaService } from './caixa.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/caixa')
@UseGuards(JwtAuthGuard)
export class CaixaController {
  constructor(private readonly caixaService: CaixaService) {}

  @Get()
  async findAll(@Req() req: any, @Query() query: any) {
    return this.caixaService.findAll(req.user.tenant_slug, query);
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    return this.caixaService.create(req.user.tenant_slug, req.user, body);
  }

  @Patch(':id/baixar')
  async baixar(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.caixaService.baixar(req.user.tenant_slug, id, body.forma_pagamento);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.caixaService.remove(req.user.tenant_slug, id);
  }
}
