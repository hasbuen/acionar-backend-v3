import { Controller, Get } from '@nestjs/common';

@Controller('api')
export class AppController {
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      system: 'Acionar v3 NestJS + Prisma Monolith API',
      timestamp: new Date().toISOString(),
    };
  }
}
