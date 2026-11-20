/**
 * TEST HARNESS: runs a full analysis in the web app (heuristic, or AI against whatever provider the
 * server is configured with, e.g. the local mock) and downloads the exports.
 *
 *   npx tsx scripts/dev/ui-smoke.ts --url http://localhost:3124 --zip pack.zip --mode ai|heuristic --shots outputs/ui-smoke
 */
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://localhost:3124")!;
const zip = arg("zip")!;
const mode = arg("mode", "heuristic")!;
const shots = arg("shots", "outputs/ui-smoke")!;
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(url);
await page.setInputFiles('input[aria-label="Upload a screenplay ZIP"]', zip);
await page.waitForSelector("text=timed beats");
if (mode === "heuristic") await page.check("input[name=mode] >> nth=1");
await page.click('button:has-text("Find promos in")');
await page.waitForSelector("text=Running", { timeout: 2000 }).catch(() => {});
await page.screenshot({ path: path.join(shots, `${mode}-running.png`) });
await page.waitForSelector("text=Episode coverage", { timeout: 15 * 60 * 1000 });
await page.screenshot({ path: path.join(shots, `${mode}-overview.png`) });
const stat = async (label: string) => (await page.locator(`p:text-is("${label}") + p`).first().innerText()).trim();
console.log({ postFirst: await stat("Post first"), recommended: await stat("Recommended"), covered: await stat("Episodes covered") });
await page.goto(`${url}/#/reports`);
await page.waitForSelector("text=Quality report preview");
const n = await page.locator('button:has-text("Download")').count();
for (let i = 0; i < n; i++) {
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('button:has-text("Download")').nth(i).click()]);
  await dl.saveAs(path.join(shots, `${mode}-${dl.suggestedFilename()}`));
  console.log("downloaded", dl.suggestedFilename());
}
console.log("browser errors:", errors.length ? errors : "none");
await browser.close();
