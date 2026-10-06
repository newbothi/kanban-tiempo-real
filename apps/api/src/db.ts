import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient } from './generated/prisma/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Falta DATABASE_URL (revisa apps/api/.env)');

// Prisma 7 se conecta a SQL Server mediante un "driver adapter" (usa el paquete mssql/tedious).
export const prisma = new PrismaClient({ adapter: new PrismaMssql(url) });
