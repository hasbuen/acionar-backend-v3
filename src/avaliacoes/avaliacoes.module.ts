import { Module } from '@nestjs/common';
import { AvaliacoesController } from './avaliacoes.controller';
import { AvaliacoesService } from './avaliacoes.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AvaliacoesController],
  providers: [AvaliacoesService],
  exports: [AvaliacoesService],
})
export class AvaliacoesModule {}
