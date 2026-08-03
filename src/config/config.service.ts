import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getPaymentConfig(tenantSlug: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const rows: any = await this.prisma.$queryRawUnsafe('SELECT valor FROM configuracoes WHERE chave = $1', 'pagamentos');
      const settings = rows[0] || { asaas_enabled: false, asaas_environment: 'sandbox', pix_key: '', pix_key_type: 'aleatoria' };
      return { settings: { ...settings, asaas_api_key: undefined, asaas_api_key_configured: Boolean(settings.asaas_api_key) } };
    });
  }

  async updatePaymentConfig(tenantSlug: string, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const currentRows: any = await this.prisma.$queryRawUnsafe('SELECT valor FROM configuracoes WHERE chave = $1', 'pagamentos');
      const current = currentRows[0] || {};
      const settings = {
        asaas_enabled: Boolean(dto.asaas_enabled),
        asaas_environment: dto.asaas_environment === 'production' ? 'production' : 'sandbox',
        pix_key: String(dto.pix_key || '').trim(),
        pix_key_type: String(dto.pix_key_type || 'aleatoria'),
        asaas_api_key: dto.asaas_api_key ? String(dto.asaas_api_key).trim() : current.asaas_api_key || ''
      };
      await this.prisma.$executeRawUnsafe('INSERT INTO configuracoes (chave, valor, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()', 'pagamentos', JSON.stringify(settings));
      return { message: 'Payment configuration saved.', settings: { ...settings, asaas_api_key: undefined, asaas_api_key_configured: Boolean(settings.asaas_api_key) } };
    });
  }

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
      message: 'Configuration updated successfully.',
      settings: updated,
    };
  }

  async uploadLogo(tenantSlug: string, imageBase64: string) {
    const cleanSlug = tenantSlug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    const uploadsDir = process.env.UPLOADS_DIR || '/var/www/acionar-v3/uploads';
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let buffer: Buffer;
    let ext = 'png';

    if (matches && matches.length === 3) {
      ext = matches[1].split('/')[1] || 'png';
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      buffer = Buffer.from(imageBase64, 'base64');
    }

    const fileKey = `logo_${cleanSlug}_${Date.now()}.${ext}`;
    const filePath = path.join(uploadsDir, fileKey);
    fs.writeFileSync(filePath, buffer);

    const publicHost = process.env.PUBLIC_HOST || 'https://76.13.230.110.nip.io';
    const fotoUrl = `${publicHost}/uploads/${fileKey}`;

    const tenant = await this.prisma.tenant.update({
      where: { slug: cleanSlug },
      data: { foto_url: fotoUrl },
    });

    return {
      message: 'Logo enviado com sucesso.',
      foto_url: fotoUrl,
      tenant,
    };
  }
}
