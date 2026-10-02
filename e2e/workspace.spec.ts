import path from "node:path";
import { expect, test } from "@playwright/test";

const SAMPLE = path.resolve(import.meta.dirname, "../samples/terrain-stockpile-epsg25832.xyz");

test("create project, upload XYZ, view, measure and save, open AI panel", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  const name = `E2E ${Date.now()}`;
  await page.getByPlaceholder("e.g. Byggefelt Nordre Ås").fill(name);
  await page.getByPlaceholder("e.g. EPSG:25832 (leave empty if unknown)").fill("EPSG:25832");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\//);

  // Upload
  await page.getByTestId("open-upload").click();
  await page.getByTestId("upload-file").setInputFiles(SAMPLE);
  await page.getByTestId("upload-submit").click();
  await expect(page.getByTestId("scan-item")).toHaveCount(1);
  await expect(page.getByTestId("status-bar")).toContainText("22,500 pts", { timeout: 20_000 });
  await expect(page.getByTestId("scan-info")).toContainText("EPSG:25832");
  await page.screenshot({ path: "test-results/workspace-loaded.png" });

  // Orbit (drag) and reset view
  const canvas = page.getByTestId("viewer-canvas");
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 200, cy + 40, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -300);
  await page.getByTestId("reset-view").click();

  // Measure two points
  await page.getByTestId("tool-measure").click();
  await page.mouse.click(cx - 120, cy + 20);
  await page.mouse.click(cx + 140, cy - 30);
  await expect(page.getByTestId("distance-3d")).toContainText(" m");
  await expect(page.getByTestId("dx")).toBeVisible();
  await expect(page.getByTestId("status-coords")).toContainText("X 598");
  await page.screenshot({ path: "test-results/workspace-measure.png" });
  await page.getByTestId("save-measurement").click();
  await expect(page.getByTestId("measurement-list").locator("li")).toHaveCount(1);

  // AI panel shows providers; without keys they are reported as not configured.
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("ai-provider")).toBeVisible();
  await page.screenshot({ path: "test-results/workspace-saved.png" });

  expect(errors).toEqual([]);
});
