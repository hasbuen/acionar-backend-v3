"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgendamentosController = void 0;
const common_1 = require("@nestjs/common");
const agendamentos_service_1 = require("./agendamentos.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
let AgendamentosController = class AgendamentosController {
    constructor(agendamentosService) {
        this.agendamentosService = agendamentosService;
    }
    async findAll(req, query) {
        return this.agendamentosService.findAll(req.user.tenant_slug, query);
    }
    async create(req, body) {
        return this.agendamentosService.create(req.user.tenant_slug, req.user, body);
    }
    async update(req, id, body) {
        return this.agendamentosService.update(req.user.tenant_slug, parseInt(id, 10), body);
    }
    async remove(req, id) {
        return this.agendamentosService.remove(req.user.tenant_slug, parseInt(id, 10));
    }
};
exports.AgendamentosController = AgendamentosController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AgendamentosController.prototype, "findAll", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AgendamentosController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], AgendamentosController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], AgendamentosController.prototype, "remove", null);
exports.AgendamentosController = AgendamentosController = __decorate([
    (0, common_1.Controller)('api/agendamentos'),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [agendamentos_service_1.AgendamentosService])
], AgendamentosController);
//# sourceMappingURL=agendamentos.controller.js.map