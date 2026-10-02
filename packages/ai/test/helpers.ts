import { createDefaultToolRegistry, type ToolContext } from "@massefelt/tools";
import { createFakeData, PROJECT_ID } from "../../tools/test/fake-data";

export const registry = createDefaultToolRegistry();

export function toolContext(selection: Partial<ToolContext["selection"]> = {}): ToolContext {
  return {
    projectId: PROJECT_ID,
    userId: "user_1",
    selection: { scanId: null, measurementId: null, objectIds: [], ...selection },
    data: createFakeData(),
  };
}

export const assistantContext = {
  project: { id: PROJECT_ID, name: "Testprosjekt" },
  selectedScan: null,
  selectedMeasurement: { id: "meas_1", name: "Distance 1" },
  selectedObjectIds: [],
  measurements: [{ id: "meas_1", name: "Distance 1" }],
};

/** Minimal stand-in for an SDK stream: async-iterable events + a final result accessor. */
export function fakeStream<E, F>(events: E[], final: F, finalKey: string) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    [finalKey]: async () => final,
  };
}

export async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}
