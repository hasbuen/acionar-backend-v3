"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_module_1 = require("./prisma/prisma.module");
const auth_module_1 = require("./auth/auth.module");
const config_module_1 = require("./config/config.module");
const public_module_1 = require("./public/public.module");
const agendamentos_module_1 = require("./agendamentos/agendamentos.module");
const servicos_module_1 = require("./servicos/servicos.module");
const clientes_module_1 = require("./clientes/clientes.module");
const caixa_module_1 = require("./caixa/caixa.module");
const estoque_module_1 = require("./estoque/estoque.module");
const app_controller_1 = require("./app.controller");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            prisma_module_1.PrismaModule,
            auth_module_1.AuthModule,
            config_module_1.ConfigModule,
            public_module_1.PublicModule,
            agendamentos_module_1.AgendamentosModule,
            servicos_module_1.ServicosModule,
            clientes_module_1.ClientesModule,
            caixa_module_1.CaixaModule,
            estoque_module_1.EstoqueModule,
        ],
        controllers: [app_controller_1.AppController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map