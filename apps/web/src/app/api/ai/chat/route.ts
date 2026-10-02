import { logger } from "@massefelt/shared";
import { getCurrentUser } from "@/server/auth";
import { readJson, route } from "@/server/http";
import { chat, chatRequestSchema } from "@/server/services/assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Streaming assistant endpoint. Response: newline-delimited JSON
 * (application/x-ndjson), one ChatStreamEvent per line.
 */
export const POST = route(async (request: Request) => {
  const user = await getCurrentUser();
  const body = chatRequestSchema.parse(await readJson(request));
  const events = chat(user, body, request.signal);
  // Pull the first event before responding so validation/authorization errors become proper HTTP errors.
  const first = await events.next();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!first.done) controller.enqueue(encoder.encode(JSON.stringify(first.value) + "\n"));
    },
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
      } catch (err) {
        logger.error("chat stream failed", { err: err instanceof Error ? err.message : String(err) });
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: "Assistant stream failed" }) + "\n"));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
