import { Module } from '@nestjs/common';
import { CaixaService } from './caixa.service';
import { CaixaController } from './caixa.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [CaixaService],
  controllers: [CaixaController],
})
export class CaixaModule {}
