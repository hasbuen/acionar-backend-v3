import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { ServicosService } from './servicos.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/servicos')
@UseGuards(JwtAuthGuard)
export class ServicosController {
  constructor(private readonly servicosService: ServicosService) {}

  @Get()
  async findAll(@Req() req: any) {
    return this.servicosService.findAll(req.user.tenant_slug, req.user);
  }

  @Post(':id/toggle-atendo')
  async toggleServicoAtendo(@Req() req: any, @Param('id') id: string) {
    return this.servicosService.toggleServicoAtendo(req.user.tenant_slug, req.user, parseInt(id, 10));
  }

  @Post('subservicos/:subId/toggle-atendo')
  async toggleSubservicoAtendo(@Req() req: any, @Param('subId') subId: string) {
    return this.servicosService.toggleSubservicoAtendo(req.user.tenant_slug, req.user, parseInt(subId, 10));
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    return this.servicosService.create(req.user.tenant_slug, req.user, body);
  }

  @Put(':id')
  async update(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.servicosService.update(req.user.tenant_slug, req.user, parseInt(id, 10), body);
  }

  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.servicosService.deleteServico(req.user.tenant_slug, req.user, parseInt(id, 10));
  }

  @Post(':id/subservicos')
  async createSubservico(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.servicosService.createSubservico(req.user.tenant_slug, req.user, parseInt(id, 10), body);
  }

  @Put(':id/subservicos/:subId')
  async updateSubservico(@Req() req: any, @Param('id') id: string, @Param('subId') subId: string, @Body() body: any) {
    return this.servicosService.updateSubservico(req.user.tenant_slug, req.user, parseInt(subId, 10), body);
  }

  @Delete(':id/subservicos/:subId')
  async deleteSubservico(@Req() req: any, @Param('id') id: string, @Param('subId') subId: string) {
    return this.servicosService.deleteSubservico(req.user.tenant_slug, req.user, parseInt(subId, 10));
  }


  @Post(':id/produtos')

  async vincularProduto(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.servicosService.vincularProduto(req.user.tenant_slug, parseInt(id, 10), body);
  }

  @Delete(':id/produtos/:produtoId')
  async removerVinculo(@Req() req: any, @Param('id') id: string, @Param('produtoId') produtoId: string) {
    return this.servicosService.removerVinculoProduto(req.user.tenant_slug, parseInt(id, 10), parseInt(produtoId, 10));
  }

  @Get(':id/produtos')
  async listarProdutos(@Req() req: any, @Param('id') id: string) {
    return this.servicosService.listarProdutosServico(req.user.tenant_slug, parseInt(id, 10));
  }

  @Post(':id/subservicos/:subId/produtos')
  async vincularProdutoSubservico(@Req() req: any, @Param('id') id: string, @Param('subId') subId: string, @Body() body: any) {
    return this.servicosService.vincularProdutoSubservico(req.user.tenant_slug, parseInt(subId, 10), body);
  }

  @Delete(':id/subservicos/:subId/produtos/:produtoId')
  async removerVinculoSubservico(@Req() req: any, @Param('id') id: string, @Param('subId') subId: string, @Param('produtoId') produtoId: string) {
    return this.servicosService.removerVinculoProdutoSubservico(req.user.tenant_slug, parseInt(subId, 10), parseInt(produtoId, 10));
  }

  @Get(':id/subservicos/:subId/produtos')
  async listarProdutosSubservico(@Req() req: any, @Param('id') id: string, @Param('subId') subId: string) {
    return this.servicosService.listarProdutosSubservico(req.user.tenant_slug, parseInt(subId, 10));
  }
}
