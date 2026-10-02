import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export * from "./generated/prisma/client";
export type { Prisma } from "./generated/prisma/client";

export type Database = InstanceType<typeof PrismaClient>;

export function createPrismaClient(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

const globalForPrisma = globalThis as unknown as { __massefeltPrisma?: Database };

/** Process-wide singleton (survives Next.js dev hot reloads). */
export function getPrisma(): Database {
  if (!globalForPrisma.__massefeltPrisma) {
    globalForPrisma.__massefeltPrisma = createPrismaClient();
  }
  return globalForPrisma.__massefeltPrisma;
}

export * from "./data-port";
