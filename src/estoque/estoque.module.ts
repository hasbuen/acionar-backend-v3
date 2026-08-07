import { Module } from '@nestjs/common';
import { EstoqueService } from './estoque.service';
import { EstoqueController } from './estoque.controller';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [AuthModule, NotificationsModule],
  providers: [EstoqueService],
  controllers: [EstoqueController],
})
export class EstoqueModule {}
