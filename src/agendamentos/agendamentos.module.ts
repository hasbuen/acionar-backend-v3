import { Module } from '@nestjs/common';
import { AgendamentosService } from './agendamentos.service';
import { AgendamentosController } from './agendamentos.controller';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [AuthModule, NotificationsModule, WhatsappModule],
  providers: [AgendamentosService],
  controllers: [AgendamentosController],
})
export class AgendamentosModule {}

