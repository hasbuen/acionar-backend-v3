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
exports.PublicController = void 0;
const common_1 = require("@nestjs/common");
const public_service_1 = require("./public.service");
let PublicController = class PublicController {
    constructor(publicService) {
        this.publicService = publicService;
    }
    async getTenantPublicInfo(slug) {
        return this.publicService.getTenantPublicInfo(slug);
    }
    async getPublicServices(slug) {
        return this.publicService.getPublicServices(slug);
    }
    async getPublicProfessionals(slug) {
        return this.publicService.getPublicProfessionals(slug);
    }
    async createPublicAppointment(slug, body) {
        return this.publicService.createPublicAppointment(slug, body);
    }
};
exports.PublicController = PublicController;
__decorate([
    (0, common_1.Get)('tenant/:slug'),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "getTenantPublicInfo", null);
__decorate([
    (0, common_1.Get)('tenant/:slug/servicos'),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "getPublicServices", null);
__decorate([
    (0, common_1.Get)('tenant/:slug/profissionais'),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "getPublicProfessionals", null);
__decorate([
    (0, common_1.Post)('tenant/:slug/agendamentos'),
    __param(0, (0, common_1.Param)('slug')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], PublicController.prototype, "createPublicAppointment", null);
exports.PublicController = PublicController = __decorate([
    (0, common_1.Controller)('api/public'),
    __metadata("design:paramtypes", [public_service_1.PublicService])
], PublicController);
//# sourceMappingURL=public.controller.js.map