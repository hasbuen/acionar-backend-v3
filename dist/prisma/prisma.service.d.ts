import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
export declare class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    getTenantSchemaName(slug: string): string;
    runInTenantSchema<T>(slug: string, callback: (prisma: PrismaClient) => Promise<T>): Promise<T>;
    ensureTenantSchema(slug: string): Promise<void>;
}
