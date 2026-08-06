import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class ProfissionaisService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantSlug: string) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const profissionais: any = await this.prisma.$queryRawUnsafe(
        `SELECT id, nome, email, telefone, cargo, foto_url, ativo,
                cor_identificadora, aceita_atendimento_externo, created_at
         FROM profissionais
         ORDER BY (cargo = 'proprietario') DESC, nome ASC`,
      );
      return { profissionais };
    });
  }

  async create(tenantSlug: string, dto: any) {
    const { nome, email, senha, cor_identificadora, aceita_atendimento_externo, cargo } = dto;
    if (!nome || !email || !senha) {
      throw new BadRequestException('Nome, e-mail e senha são obrigatórios.');
    }

    const cleanEmail = email.toLowerCase().trim();

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const existing: any = await this.prisma.$queryRawUnsafe(
        'SELECT id FROM profissionais WHERE email = $1',
        cleanEmail,
      );
      if (existing && existing.length > 0) {
        throw new ConflictException(`E-mail '${cleanEmail}' já está cadastrado.`);
      }

      const salt = await bcrypt.genSalt(10);
      const senha_hash = await bcrypt.hash(senha, salt);

      const res: any = await this.prisma.$queryRawUnsafe(
        `INSERT INTO profissionais (
          nome, email, senha_hash, cargo, cor_identificadora, aceita_atendimento_externo, ativo
        ) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id, nome, email, cargo, cor_identificadora, aceita_atendimento_externo, ativo`,
        nome,
        cleanEmail,
        senha_hash,
        cargo || 'auxiliar',
        cor_identificadora || '#8c52ff',
        Boolean(aceita_atendimento_externo),
      );

      return { profissional: res[0] };
    });
  }

  async update(tenantSlug: string, id: number, dto: any) {
    const { nome, email, senha, cor_identificadora, aceita_atendimento_externo, ativo } = dto;

    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const existing: any = await this.prisma.$queryRawUnsafe(
        'SELECT * FROM profissionais WHERE id = $1',
        id,
      );
      if (!existing || existing.length === 0) {
        throw new NotFoundException('Profissional não encontrado.');
      }

      let senha_hash = existing[0].senha_hash;
      if (senha && senha.trim() !== '') {
        const salt = await bcrypt.genSalt(10);
        senha_hash = await bcrypt.hash(senha, salt);
      }

      const cleanEmail = email ? email.toLowerCase().trim() : existing[0].email;

      const res: any = await this.prisma.$queryRawUnsafe(
        `UPDATE profissionais
         SET nome = COALESCE($1, nome),
             email = COALESCE($2, email),
             senha_hash = $3,
             cor_identificadora = COALESCE($4, cor_identificadora),
             aceita_atendimento_externo = COALESCE($5, aceita_atendimento_externo),
             ativo = COALESCE($6, ativo)
         WHERE id = $7
         RETURNING id, nome, email, cargo, cor_identificadora, aceita_atendimento_externo, ativo`,
        nome || null,
        cleanEmail || null,
        senha_hash,
        cor_identificadora || null,
        aceita_atendimento_externo !== undefined ? Boolean(aceita_atendimento_externo) : null,
        ativo !== undefined ? Boolean(ativo) : null,
        id,
      );

      return { profissional: res[0] };
    });
  }

  async remove(tenantSlug: string, id: number) {
    await this.prisma.ensureTenantSchema(tenantSlug);
    return this.prisma.runInTenantSchema(tenantSlug, async () => {
      const existing: any = await this.prisma.$queryRawUnsafe(
        'SELECT cargo FROM profissionais WHERE id = $1',
        id,
      );
      if (!existing || existing.length === 0) {
        throw new NotFoundException('Profissional não encontrado.');
      }
      if (existing[0].cargo === 'proprietario') {
        throw new BadRequestException('Não é possível remover o profissional proprietário.');
      }

      await this.prisma.$queryRawUnsafe('DELETE FROM profissionais WHERE id = $1', id);
      return { message: 'Auxiliar removido com sucesso.' };
    });
  }
}
