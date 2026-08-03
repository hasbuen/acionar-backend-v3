import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfissionaisController } from './profissionais.controller';
import { ProfissionaisService } from './profissionais.service';

@Module({ imports: [AuthModule], controllers: [ProfissionaisController], providers: [ProfissionaisService] })
export class ProfissionaisModule {}
