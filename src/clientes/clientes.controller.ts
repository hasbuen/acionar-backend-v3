import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';


@Controller('api/clientes')
@UseGuards(JwtAuthGuard)
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Get()
  async findAll(@Req() req: any) {
    return this.clientesService.findAll(req.user.tenant_slug, req.user);
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    return this.clientesService.create(req.user.tenant_slug, req.user, body);
  }


  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.clientesService.update(req.user.tenant_slug, parseInt(id, 10), body);
  }

  @Post(':id/transferir')
  async transferir(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.clientesService.transferir(req.user.tenant_slug, parseInt(id, 10), body.profissional_destino_id, req.user);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.clientesService.remove(req.user.tenant_slug, req.user, parseInt(id, 10));
  }
}



