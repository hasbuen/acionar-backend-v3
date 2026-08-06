import { Module } from '@nestjs/common';
import { AgendamentosService } from './agendamentos.service';
import { AgendamentosController } from './agendamentos.controller';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  providers: [AgendamentosService],
  controllers: [AgendamentosController],
})
export class AgendamentosModule {}

