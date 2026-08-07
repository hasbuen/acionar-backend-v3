import { Injectable, ConflictException, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async registerTenant(dto: any) {
    const { slug, nome_empresa, email_proprietario, senha, telefone, foto_url, cor_primaria, cor_texto_principal, cor_texto_secundario } = dto;
    const cleanSlug = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');

    const existing = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
    if (existing) {
      throw new ConflictException(`Slug '${cleanSlug}' is already registered.`);
    }

    const salt = await bcrypt.genSalt(10);
    const senha_hash = await bcrypt.hash(senha, salt);

    const tenant = await this.prisma.tenant.create({
      data: {
        slug: cleanSlug,
        nome_empresa,
        email_proprietario,
        telefone: telefone || null,
        senha_hash,
        foto_url: foto_url || null,
        cor_primaria: cor_primaria || '#0d9488',
        cor_texto_principal: cor_texto_principal || '#ffffff',
        cor_texto_secundario: cor_texto_secundario || '#94a3b8',
      },
    });

    await this.prisma.ensureTenantSchema(cleanSlug);

    const owner = await this.prisma.runInTenantSchema(cleanSlug, async () => {
      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO profissionais (nome, email, telefone, cargo, foto_url, senha_hash)
         VALUES ($1, $2, $3, 'proprietario', $4, $5) RETURNING id, nome, email, cargo`,
        nome_empresa, email_proprietario, telefone || null, foto_url || null, senha_hash
      );
      return res[0];
    });

    const token = this.jwtService.sign({
      tenant_slug: cleanSlug,
      profissional_id: owner.id,
      email: owner.email,
      cargo: owner.cargo,
    });

    return {
      message: 'Tenant registered successfully.',
      token,
      tenant,
      user: owner,
    };
  }

  async login(dto: any) {
    const { slug, email, senha } = dto;
    
    let resolvedSlug = slug;

    if (!resolvedSlug) {
      // 1. Tentar encontrar o tenant na tabela global public.tenants onde email_proprietario = email
      const matchingTenant = await this.prisma.tenant.findFirst({
        where: { email_proprietario: email.toLowerCase().trim() }
      });
      if (matchingTenant) {
        resolvedSlug = matchingTenant.slug;
      } else {
        // 2. Senão, listar todos os tenants e procurar nos profissionais de cada schema
        const allTenants = await this.prisma.tenant.findMany({
          select: { slug: true }
        });
        
        for (const t of allTenants) {
          try {
            await this.prisma.ensureTenantSchema(t.slug);
            const users: any = await this.prisma.runInTenantSchema(t.slug, async () => {
              return await this.prisma.$queryRawUnsafe(
                'SELECT id FROM profissionais WHERE email = $1',
                email.toLowerCase().trim()
              );
            });
            if (users && users.length > 0) {
              resolvedSlug = t.slug;
              break;
            }
          } catch (e) {
            // Ignorar erros em schemas individuais
          }
        }
      }
    }

    if (!resolvedSlug) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const cleanSlug = resolvedSlug.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_');

    const tenant = await this.prisma.tenant.findUnique({ where: { slug: cleanSlug } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }
    if (tenant.status !== 'ativo') {
      throw new ForbiddenException('Tenant is inactive.');
    }

    await this.prisma.ensureTenantSchema(cleanSlug);

    const users: any = await this.prisma.runInTenantSchema(cleanSlug, async () => {
      return await this.prisma.$queryRawUnsafe(
        'SELECT id, nome, email, cargo, foto_url, senha_hash, ativo FROM profissionais WHERE email = $1',
        email.toLowerCase().trim()
      );
    });

    if (!users || users.length === 0) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const user = users[0];
    if (!user.ativo) {
      throw new ForbiddenException('User account is inactive.');
    }

    const valid = await bcrypt.compare(senha, user.senha_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    const token = this.jwtService.sign({
      tenant_slug: cleanSlug,
      profissional_id: user.id,
      email: user.email,
      cargo: user.cargo,
    });

    delete user.senha_hash;

    return {
      token,
      tenant,
      user,
    };
  }

  async me(payload: any) {
    const { tenant_slug, email } = payload;
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenant_slug } });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    const users: any = await this.prisma.runInTenantSchema(tenant_slug, async () => {
      return await this.prisma.$queryRawUnsafe(
        'SELECT id, nome, email, telefone, cargo, foto_url, ativo FROM profissionais WHERE email = $1',
        email
      );
    });

    if (!users || users.length === 0) throw new NotFoundException('User profile not found.');

    return {
      tenant,
      user: users[0],
    };
  }
}
