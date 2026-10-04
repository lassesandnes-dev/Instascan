/**
 * @massefelt/tools — the deterministic tool layer between AI models and
 * project/3D data.
 *
 * - Every tool has a Zod input schema; arguments from a model are validated
 *   before execution.
 * - Tools are scoped to the project in the server-side ToolContext; a model
 *   can never choose which project (or organization) it reads.
 * - Geometry is computed by @massefelt/geometry, never by the model.
 * - The registry is transport-agnostic: the same tools are exposed to
 *   OpenAI, Anthropic and the MCP server.
 */
export * from "./types";
export * from "./data-port";
export * from "./registry";
export * from "./definitions";
export * from "./terrain-tools";
