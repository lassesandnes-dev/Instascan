import path from "node:path";
import { expect, test } from "@playwright/test";

const SAMPLE = path.resolve(import.meta.dirname, "../samples/terrain-stockpile-epsg25832.xyz");

test("build surface, draw polygon, calculate volume, create cross section", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByPlaceholder("e.g. Byggefelt Nordre Ås").fill(`Terrain E2E ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\//);
  await page.getByTestId("open-upload").click();
  await page.getByTestId("upload-file").setInputFiles(SAMPLE);
  await page.getByTestId("upload-submit").click();
  await expect(page.getByTestId("status-bar")).toContainText("22,500 pts", { timeout: 20_000 });

  // Build a DEM from the selected scan (suggested cell size from point density).
  await expect(page.getByTestId("surface-cell-size")).toHaveValue("0.5");
  await page.getByTestId("build-surface").click();
  await expect(page.getByTestId("surface-list").locator("li")).toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("reset-view").click();

  const box = (await page.getByTestId("viewer-canvas").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Volume: four boundary clicks, close, calculate.
  await page.getByTestId("tool-volume").click();
  for (const [dx, dy] of [[-160, -40], [120, -60], [160, 80], [-120, 100]]) await page.mouse.click(cx + dx!, cy + dy!);
  await page.getByTestId("close-polygon").click();
  await page.getByTestId("calculate-volume").click();
  await expect(page.getByTestId("volume-result")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("volume-above")).toContainText("m³");
  await expect(page.getByTestId("volume-list").locator("li")).toHaveCount(1);
  await page.screenshot({ path: "test-results/terrain-volume.png" });

  // Cross section: two clicks, create.
  await page.getByTestId("tool-section").click();
  await page.mouse.click(cx - 200, cy + 10);
  await page.mouse.click(cx + 200, cy - 10);
  await page.getByTestId("create-section").click();
  await expect(page.getByTestId("profile-chart")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("section-list").locator("li")).toHaveCount(1);
  await page.screenshot({ path: "test-results/terrain-section.png" });

  expect(errors).toEqual([]);
});
