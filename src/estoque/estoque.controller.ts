import { Controller, Get, Post, Body, Req, UseGuards, Query } from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/estoque')
@UseGuards(JwtAuthGuard)
export class EstoqueController {
  constructor(private readonly estoqueService: EstoqueService) {}

  @Get('produtos')
  async findProdutos(@Req() req: any) {
    return this.estoqueService.findProdutos(req.user.tenant_slug);
  }

  @Post('produtos')
  async createProduto(@Req() req: any, @Body() body: any) {
    return this.estoqueService.createProduto(req.user.tenant_slug, req.user, body);
  }

  @Get('movimentacoes')
  async findMovimentacoes(@Req() req: any, @Query() query: any) {
    return this.estoqueService.findMovimentacoes(req.user.tenant_slug, query);
  }

  @Post('movimentacoes')
  async createMovimentacao(@Req() req: any, @Body() body: any) {
    return this.estoqueService.createMovimentacao(req.user.tenant_slug, req.user, body);
  }

  @Post('transferencias')
  async transferProduto(@Req() req: any, @Body() body: any) {
    return this.estoqueService.transferProduto(req.user.tenant_slug, req.user, body);
  }

  @Get('alertas')
  async findAlerts(@Req() req: any) {
    return this.estoqueService.findAlerts(req.user.tenant_slug);
  }
}
