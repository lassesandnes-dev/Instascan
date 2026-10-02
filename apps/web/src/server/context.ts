import "server-only";
import { createProvidersFromEnv, type AIProvider, type ProviderId } from "@massefelt/ai";
import { getPrisma, PrismaProjectDataPort, type Database } from "@massefelt/database";
import { createStorageFromEnv, type ObjectStorage } from "@massefelt/storage";
import { createDefaultToolRegistry, type ToolRegistry } from "@massefelt/tools";

/**
 * Process-wide service container. Tests can override members with
 * `setServices` to inject fakes (e.g. a scripted AI provider).
 */
export interface Services {
  db: Database;
  storage: ObjectStorage;
  data: PrismaProjectDataPort;
  tools: ToolRegistry;
  providers: Record<ProviderId, AIProvider>;
}

const g = globalThis as unknown as { __massefeltServices?: Services };

export function services(): Services {
  if (!g.__massefeltServices) {
    const db = getPrisma();
    g.__massefeltServices = {
      db,
      storage: createStorageFromEnv(),
      data: new PrismaProjectDataPort(db),
      tools: createDefaultToolRegistry(),
      providers: createProvidersFromEnv(),
    };
  }
  return g.__massefeltServices;
}

export function setServices(overrides: Partial<Services>): void {
  g.__massefeltServices = { ...services(), ...overrides };
}
