import { Controller, Get, Post, Put, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
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
