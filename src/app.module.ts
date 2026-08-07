import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { PublicModule } from './public/public.module';
import { AgendamentosModule } from './agendamentos/agendamentos.module';
import { ServicosModule } from './servicos/servicos.module';
import { ClientesModule } from './clientes/clientes.module';
import { CaixaModule } from './caixa/caixa.module';
import { EstoqueModule } from './estoque/estoque.module';
import { ProfissionaisModule } from './profissionais/profissionais.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    NestConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    ConfigModule,
    PublicModule,
    AgendamentosModule,
    ServicosModule,
    ClientesModule,
    CaixaModule,
    EstoqueModule,
    ProfissionaisModule,
    NotificationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

