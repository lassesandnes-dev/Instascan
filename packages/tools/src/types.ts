import type { z } from "zod";
import type { ProjectDataPort } from "./data-port";

/** What the user currently has selected in the UI. Supplied by the client, verified server-side by tools. */
export interface UISelection {
  scanId: string | null;
  measurementId: string | null;
  objectIds: string[];
  surfaceId?: string | null;
  volumeId?: string | null;
  crossSectionId?: string | null;
}

/** Server-side execution context. Never populated from model output. */
export interface ToolContext {
  projectId: string;
  userId: string;
  selection: UISelection;
  data: ProjectDataPort;
}

export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: TSchema;
  /** Read-only tools never mutate state. Mutating tools may require confirmation in future. */
  readOnly: boolean;
  execute(input: z.output<TSchema>, ctx: ToolContext): Promise<TResult>;
}

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

/** Provider-neutral tool description (JSON Schema), consumed by AI providers and MCP. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallAudit {
  toolName: string;
  arguments: unknown;
  result: ToolResult;
  durationMs: number;
}
