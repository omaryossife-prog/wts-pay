import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

export function createPrisma(databaseUrl: string) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
  });

  return new PrismaClient({ adapter });
}

export type Db = PrismaClient | Prisma.TransactionClient;
