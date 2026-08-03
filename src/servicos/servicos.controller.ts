import { Controller, Get, Post, Put, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ServicosService } from './servicos.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/servicos')
@UseGuards(JwtAuthGuard)
export class ServicosController {
  constructor(private readonly servicosService: ServicosService) {}

  @Get()
  async findAll(@Req() req: any) {
    return this.servicosService.findAll(req.user.tenant_slug);
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    return this.servicosService.create(req.user.tenant_slug, body);
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.servicosService.update(req.user.tenant_slug, parseInt(id, 10), body);
  }
}
