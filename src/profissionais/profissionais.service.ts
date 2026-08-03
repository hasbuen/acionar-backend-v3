import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProfissionaisService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const profissionais: any = await this.prisma.$queryRawUnsafe('SELECT id, nome, email, telefone, cargo FROM profissionais WHERE ativo = true ORDER BY nome ASC');
      return { profissionais };
    });
  }
}
