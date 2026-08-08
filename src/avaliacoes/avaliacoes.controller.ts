import { Controller, Get, Req, Query, UseGuards } from '@nestjs/common';
import { AvaliacoesService } from './avaliacoes.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/avaliacoes')
@UseGuards(JwtAuthGuard)
export class AvaliacoesController {
  constructor(private readonly avaliacoesService: AvaliacoesService) {}

  @Get()
  async findAll(@Req() req: any, @Query() query: any) {
    return this.avaliacoesService.findAll(req.user.tenant_slug, req.user, query);
  }

  @Get('ranking')
  async getRanking(@Req() req: any) {
    return this.avaliacoesService.getRanking(req.user.tenant_slug, req.user);
  }
}
