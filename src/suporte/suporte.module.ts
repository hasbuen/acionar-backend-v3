import { Module } from '@nestjs/common';
import { SuporteController } from './suporte.controller';
import { SuporteService } from './suporte.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [SuporteController],
  providers: [SuporteService],
  exports: [SuporteService],
})
export class SuporteModule {}
