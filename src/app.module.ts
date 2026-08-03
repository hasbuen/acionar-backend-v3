import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { PublicModule } from './public/public.module';
import { AgendamentosModule } from './agendamentos/agendamentos.module';
import { ServicosModule } from './servicos/servicos.module';
import { ClientesModule } from './clientes/clientes.module';
import { CaixaModule } from './caixa/caixa.module';
import { EstoqueModule } from './estoque/estoque.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    NestConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ConfigModule,
    PublicModule,
    AgendamentosModule,
    ServicosModule,
    ClientesModule,
    CaixaModule,
    EstoqueModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
