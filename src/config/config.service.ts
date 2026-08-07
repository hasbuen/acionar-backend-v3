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
      return { settings };
    });
  }

  async updatePaymentConfig(tenantSlug: string, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const settings = {
        asaas_enabled: Boolean(dto.asaas_enabled),
        asaas_environment: dto.asaas_environment === 'production' ? 'production' : 'sandbox',
        pix_key: String(dto.pix_key || '').trim(),
        pix_key_type: String(dto.pix_key_type || 'aleatoria'),
      };
      await this.prisma.$executeRawUnsafe('INSERT INTO configuracoes (chave, valor, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()', 'pagamentos', JSON.stringify(settings));
      return { message: 'Payment configuration saved.', settings };
    });
  }

  async getPublicScheduleConfig(tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: {
        slug: true,
        subdominio: true,
        nome_empresa: true,
        foto_url: true,
        cor_primaria: true,
        cor_destaque: true,
        cor_fundo: true,
        cor_texto_principal: true,
        cor_texto_secundario: true,
        agenda_publica_ativa: true,
      },
    });

    if (!tenant) throw new NotFoundException('Tenant not found.');
    return {
      settings: {
        ...tenant,
        slug: tenant.subdominio || tenant.slug,
      }
    };
  }

  async updatePublicScheduleConfig(tenantSlug: string, dto: any) {
    const { agenda_publica_ativa, foto_url, cor_primaria, cor_destaque, cor_fundo, cor_texto_principal, cor_texto_secundario, novo_slug, nome_empresa } = dto;

    const currentTenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!currentTenant) throw new NotFoundException('Tenant not found.');

    const isAtiva = agenda_publica_ativa !== undefined ? Boolean(agenda_publica_ativa) : currentTenant.agenda_publica_ativa;

    if (nome_empresa !== undefined && nome_empresa !== currentTenant.nome_empresa) {
      if (!isAtiva) {
        throw new ConflictException('Não é possível alterar o nome da empresa com a agenda pública desativada.');
      }
    }

    let targetSubdomain = null;

    if (novo_slug) {
      const cleanSub = novo_slug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
      if (cleanSub !== tenantSlug) {
        const existing = await this.prisma.tenant.findFirst({
          where: {
            OR: [
              { subdominio: cleanSub },
              { slug: cleanSub }
            ],
            slug: { not: tenantSlug }
          }
        });
        if (existing) {
          throw new ConflictException(`Slug '${cleanSub}' is already taken.`);
        }
        targetSubdomain = cleanSub;
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { slug: tenantSlug },
      data: {
        subdominio: targetSubdomain,
        nome_empresa: nome_empresa !== undefined && isAtiva ? String(nome_empresa).trim() : undefined,
        agenda_publica_ativa: agenda_publica_ativa !== undefined ? agenda_publica_ativa : undefined,
        foto_url: foto_url !== undefined ? foto_url : undefined,
        cor_primaria: cor_primaria || undefined,
        cor_destaque: cor_destaque || undefined,
        cor_fundo: cor_fundo || undefined,
        cor_texto_principal: cor_texto_principal || undefined,
        cor_texto_secundario: cor_texto_secundario || undefined,
      },
      select: {
        slug: true,
        subdominio: true,
        nome_empresa: true,
        foto_url: true,
        cor_primaria: true,
        cor_destaque: true,
        cor_fundo: true,
        cor_texto_principal: true,
        cor_texto_secundario: true,
        agenda_publica_ativa: true,
      },
    });

    return {
      message: 'Configuration updated successfully.',
      settings: {
        ...updated,
        slug: updated.subdominio || updated.slug,
      },
    };
  }

  async getMessageConfig(tenantSlug: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const rows: any = await this.prisma.$queryRawUnsafe('SELECT valor FROM configuracoes WHERE chave = $1', 'mensagens');
      const defaultSettings = {
        endereco: 'Rua da amizade 515 bairro: 14 de novembro',
        template_confirmacao: `📍 *Endereço*: {endereco}\n\nPor gentileza, informe se concorda com este horário ou se prefere realizar alguma alteração.\n\n📌 *Lembrete importante*: Pedimos a gentileza de chegar com **15 minutos de antecedência**.\n\nAgradecemos a preferência e aguardamos você!😊`,
        template_manutencao: `Olá, *{cliente}*! 👋\n\nPassando para lembrar que sua *MANUTENÇÃO PERIÓDICA* de *{servico}* está agendada para o dia *{data}* às *{hora}*.\n\n📍 *Endereço*: {endereco}`,
      };
      const settings = rows[0]?.valor || defaultSettings;
      return { settings };
    });
  }

  async updateMessageConfig(tenantSlug: string, dto: any) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const settings = {
        endereco: dto.endereco || '',
        template_confirmacao: dto.template_confirmacao || '',
        template_manutencao: dto.template_manutencao || '',
      };
      await this.prisma.$executeRawUnsafe(
        'INSERT INTO configuracoes (chave, valor, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()',
        'mensagens',
        JSON.stringify(settings),
      );
      return { message: 'Configurações de mensagens salvas com sucesso.', settings };
    });
  }

  async uploadLogo(tenantSlug: string, imageBase64: string) {
    const cleanSlug = tenantSlug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');
    const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');
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

    const publicHost = process.env.PUBLIC_HOST;
    const fotoUrl = publicHost ? `${publicHost}/uploads/${fileKey}` : `/uploads/${fileKey}`;

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

