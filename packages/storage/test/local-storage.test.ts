import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalFileStorage, assertSafeKey } from "../src";

describe("LocalFileStorage", () => {
  let dir: string;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("puts, gets, checks and deletes objects", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "mf-storage-"));
    const s = new LocalFileStorage(dir);
    await s.put("projects/p1/a.bin", new Uint8Array([1, 2, 3]));
    expect(await s.exists("projects/p1/a.bin")).toBe(true);
    expect(Array.from(await s.get("projects/p1/a.bin"))).toEqual([1, 2, 3]);
    await s.delete("projects/p1/a.bin");
    expect(await s.exists("projects/p1/a.bin")).toBe(false);
  });

  it("rejects path traversal and unsafe keys", () => {
    for (const bad of ["../etc/passwd", "/abs", "a/../../b", "a//b", "", "a b"]) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
  });
});
