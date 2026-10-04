import "server-only";
import { z } from "zod";
import { runAssistant, type AIStreamEvent, type ChatMessage } from "@massefelt/ai";
import { AppError, NotFoundError, logger } from "@massefelt/shared";
import type { ToolContext } from "@massefelt/tools";
import type { CurrentUser } from "../auth";
import { services } from "../context";
import { serverEnv } from "../env";
import { requireProject } from "./projects";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

export const chatRequestSchema = z.object({
  projectId: id,
  provider: z.enum(["openai", "anthropic"]),
  conversationId: id.nullable().optional(),
  message: z.string().trim().min(1),
  selection: z
    .object({
      scanId: id.nullable().default(null),
      measurementId: id.nullable().default(null),
      objectIds: z.array(id).max(100).default([]),
      surfaceId: id.nullable().default(null),
      volumeId: id.nullable().default(null),
    })
    .default({ scanId: null, measurementId: null, objectIds: [], surfaceId: null, volumeId: null }),
});

/** Event stream sent to the browser: assistant events plus the conversation id. */
export type ChatStreamEvent = AIStreamEvent | { type: "conversation"; id: string };

const HISTORY_LIMIT = 30;

/**
 * Run one assistant turn. History is loaded from the database (the client
 * cannot inject assistant turns), selection ids are verified against the
 * project, and every tool call is written to the AIToolCall audit log.
 */
export async function* chat(user: CurrentUser, input: unknown, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
  const env = serverEnv();
  const req = chatRequestSchema.parse(input);
  if (req.message.length > env.AI_MAX_MESSAGE_CHARS) {
    throw new AppError("message_too_long", `Message exceeds ${env.AI_MAX_MESSAGE_CHARS} characters`, 400);
  }
  const project = await requireProject(user, req.projectId);
  const { db, data, tools, providers } = services();
  const provider = providers[req.provider];
  if (!provider.isConfigured()) {
    throw new AppError(
      "provider_not_configured",
      `${provider.label} is not configured on the server. Set ${req.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} and restart.`,
      503,
    );
  }

  // Verify selection belongs to this project; silently drop ids that don't.
  const [scan, measurement, measurements, surfaces, volume] = await Promise.all([
    req.selection.scanId ? db.scan.findFirst({ where: { id: req.selection.scanId, projectId: project.id } }) : null,
    req.selection.measurementId
      ? db.measurement.findFirst({ where: { id: req.selection.measurementId, projectId: project.id } })
      : null,
    db.measurement.findMany({ where: { projectId: project.id }, select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 50 }),
    db.asset.findMany({ where: { projectId: project.id, kind: "SURFACE" }, select: { id: true, name: true }, orderBy: { createdAt: "asc" }, take: 50 }),
    req.selection.volumeId
      ? db.volumeCalculation.findFirst({ where: { id: req.selection.volumeId, projectId: project.id }, select: { id: true, name: true } })
      : null,
  ]);
  const surface = surfaces.find((s) => s.id === req.selection.surfaceId) ?? null;
  const objectIds = req.selection.objectIds.length
    ? (
        await db.sceneObject.findMany({ where: { projectId: project.id, id: { in: req.selection.objectIds } }, select: { id: true } })
      ).map((o) => o.id)
    : [];

  let conversation = req.conversationId
    ? await db.aIConversation.findFirst({ where: { id: req.conversationId, projectId: project.id, userId: user.id } })
    : null;
  if (req.conversationId && !conversation) throw new NotFoundError("Conversation", req.conversationId);
  conversation ??= await db.aIConversation.create({
    data: { projectId: project.id, userId: user.id, provider: provider.id, model: provider.model, title: req.message.slice(0, 80) },
  });
  yield { type: "conversation", id: conversation.id };

  const previous = await db.aIMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  const history: ChatMessage[] = previous
    .reverse()
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  history.push({ role: "user", content: req.message });
  await db.aIMessage.create({ data: { conversationId: conversation.id, role: "user", content: req.message } });

  const toolContext: ToolContext = {
    projectId: project.id,
    userId: user.id,
    selection: {
      scanId: scan?.id ?? null,
      measurementId: measurement?.id ?? null,
      objectIds,
      surfaceId: surface?.id ?? null,
      volumeId: volume?.id ?? null,
    },
    data,
  };
  const conversationId = conversation.id;
  let answer = "";

  for await (const event of runAssistant({
    provider,
    registry: tools,
    toolContext,
    assistantContext: {
      project: { id: project.id, name: project.name },
      selectedScan: scan ? { id: scan.id, name: scan.name } : null,
      selectedMeasurement: measurement ? { id: measurement.id, name: measurement.name } : null,
      selectedObjectIds: objectIds,
      measurements,
      selectedSurface: surface,
      selectedVolume: volume,
      surfaces,
    },
    history,
    maxToolRounds: env.AI_MAX_TOOL_ROUNDS,
    signal,
    logger: logger.child({ conversationId }),
    onToolAudit: async (audit) => {
      await db.aIToolCall.create({
        data: {
          projectId: project.id,
          conversationId,
          provider: provider.id,
          toolName: audit.toolName,
          arguments: (audit.arguments ?? {}) as object,
          ok: audit.result.ok,
          result: audit.result.ok ? (JSON.parse(JSON.stringify(audit.result.data ?? null)) as object) : undefined,
          error: audit.result.ok ? null : `${audit.result.error.code}: ${audit.result.error.message}`,
          durationMs: audit.durationMs,
        },
      });
    },
  })) {
    if (event.type === "text") answer += event.delta;
    yield event;
  }

  if (answer.trim()) {
    await db.aIMessage.create({ data: { conversationId, role: "assistant", content: answer } });
  }
}
