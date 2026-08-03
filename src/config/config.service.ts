import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicScheduleConfig(tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: {
        slug: true,
        nome_empresa: true,
        foto_url: true,
        cor_primaria: true,
        cor_destaque: true,
        cor_fundo: true,
        agenda_publica_ativa: true,
      },
    });

    if (!tenant) throw new NotFoundException('Tenant not found.');
    return { settings: tenant };
  }

  async updatePublicScheduleConfig(tenantSlug: string, dto: any) {
    const { agenda_publica_ativa, foto_url, cor_primaria, cor_destaque, cor_fundo, novo_slug } = dto;
    let targetSlug = tenantSlug;

    if (novo_slug && novo_slug !== tenantSlug) {
      const cleanSlug = novo_slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
      const existing = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
      if (existing) {
        throw new ConflictException(`Slug '${cleanSlug}' is already taken.`);
      }
      targetSlug = cleanSlug;
    }

    const updated = await this.prisma.tenant.update({
      where: { slug: tenantSlug },
      data: {
        slug: targetSlug,
        agenda_publica_ativa: agenda_publica_ativa !== undefined ? agenda_publica_ativa : undefined,
        foto_url: foto_url !== undefined ? foto_url : undefined,
        cor_primaria: cor_primaria || undefined,
        cor_destaque: cor_destaque || undefined,
        cor_fundo: cor_fundo || undefined,
      },
      select: {
        slug: true,
        nome_empresa: true,
        foto_url: true,
        cor_primaria: true,
        cor_destaque: true,
        cor_fundo: true,
        agenda_publica_ativa: true,
      },
    });

    return {
      message: 'Public schedule configuration updated successfully.',
      settings: updated,
    };
  }
}
