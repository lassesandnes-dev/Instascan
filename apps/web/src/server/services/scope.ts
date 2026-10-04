import "server-only";
import type { ToolContext } from "@massefelt/tools";
import type { CurrentUser } from "../auth";
import { services } from "../context";

/** A tool context for server-side reuse of tool logic (UI actions use the same code paths as the AI). */
export function toolContextFor(user: CurrentUser, projectId: string): ToolContext {
  return {
    projectId,
    userId: user.id,
    selection: { scanId: null, measurementId: null, objectIds: [] },
    data: services().data,
  };
}
