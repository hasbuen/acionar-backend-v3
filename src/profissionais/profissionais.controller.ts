import { Controller, Get, Req, UseGuards } from '@nestjs/common';
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
}
