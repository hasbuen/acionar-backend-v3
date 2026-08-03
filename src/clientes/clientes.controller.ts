import { Controller, Get, Post, Put, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/clientes')
@UseGuards(JwtAuthGuard)
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get()
  async findAll(@Req() req: any) {
    return this.clientesService.findAll(req.user.tenant_slug);
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    return this.clientesService.create(req.user.tenant_slug, body);
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.clientesService.update(req.user.tenant_slug, parseInt(id, 10), body);
  }
}
