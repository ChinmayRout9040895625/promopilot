/**
 * TEST HARNESS: tours every dashboard page in a headless system browser and checks displayed values
 * against the results JSON. Screenshots go to --shots. Local only; screenshots contain screenplay text.
 *
 *   npx tsx scripts/dev/ui-tour.ts --url http://localhost:3125 --zip pack.zip --results outputs/final/ai/promos.json --shots outputs/ui-tour
 */
import { chromium, type Page } from "playwright-core";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const url = arg("url", "http://localhost:3125")!;
const zip = arg("zip")!;
const results = arg("results")!;
const shots = arg("shots", "outputs/ui-tour")!;
await mkdir(shots, { recursive: true });
const json = JSON.parse(await readFile(results, "utf8"));
const P = json.promos as any[];
const checks: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => checks.push([name, ok, detail]);

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });

async function newPage(width: number, scheme: "light" | "dark") {
  const page = await browser.newPage({ viewport: { width, height: 950 }, colorScheme: scheme, acceptDownloads: true });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/status of 503/.test(m.text()) && errors.push(m.text()));
  return { page, errors };
}

async function loadSaved(page: Page) {
  await page.setInputFiles('input[aria-label="Upload a screenplay ZIP"]', zip);
  await page.waitForSelector("text=timed beats");
  await page.setInputFiles('input[aria-label="Open a saved promos.json results file"]', results);
  await page.waitForSelector("text=Episode coverage");
}

const shot = (page: Page, name: string, full = false) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

// ---------------------------------------------------------------- desktop light: full tour
{
  const { page, errors } = await newPage(1440, "light");
  await page.goto(url);
  await page.waitForSelector("text=Drop the screenplay ZIP here");
  await shot(page, "01-empty-overview");
  for (const v of ["promos", "candidates", "analytics", "reports"]) {
    await page.goto(`${url}/#/${v}`);
    await page.waitForSelector("text=Go to Overview");
  }
  check("empty states on all pages", true);
  await shot(page, "02-empty-reports");

  await page.goto(`${url}/#/overview`);
  await page.setInputFiles('input[aria-label="Upload a screenplay ZIP"]', zip);
  await page.waitForSelector("text=timed beats");
  await shot(page, "03-setup");
  check("parse summary: 50 episodes", (await page.locator("text=50 episodes").count()) > 0);
  await page.setInputFiles('input[aria-label="Open a saved promos.json results file"]', results);
  await page.waitForSelector("text=Episode coverage");
  await shot(page, "04-overview", true);
  const stat = async (label: string) => (await page.locator(`p:text-is("${label}") + p`).first().innerText()).trim();
  check("stat post first", (await stat("Post first")) === String(P.filter((p) => p.headline).length), await stat("Post first"));
  check("stat recommended", (await stat("Recommended")) === String(P.filter((p) => p.status === "recommended").length), await stat("Recommended"));
  check("stat weak", (await stat("Flagged weak")) === String(P.filter((p) => p.status === "weak").length), await stat("Flagged weak"));
  check("stat candidates", (await stat("Candidates checked")) === String(json.candidatesConsidered ? new Set(json.decisions.map((d: any) => d.candidateId)).size : ""), await stat("Candidates checked"));
  check("verification alert", (await page.locator("text=every timestamp is a real beat boundary").count()) === 1);
  check("mode badge", (await page.locator("header >> text=AI analysis").count()) > 0);
  check("coverage strip has 50 cells", (await page.locator('button[aria-label^="Episode "]').count()) === 50);

  // Ranked promos
  await page.click('nav >> text=Ranked Promos');
  await page.waitForSelector('ol[aria-label="Ranked promos"]');
  await shot(page, "05-promos");
  const listCount = await page.locator('ol[aria-label="Ranked promos"] > li').count();
  check("post-first list = 20", listCount === P.filter((p) => p.headline).length, String(listCount));
  const detailTitle = await page.locator('article[aria-label^="Promo rank"] h2').first().innerText();
  check("detail shows #1 by default", detailTitle.startsWith("#1"), detailTitle);
  check("rank reason shown", (await page.locator("text=Why this rank.").count()) > 0);
  check("timestamps of #1 shown", (await page.locator(`article >> text=${P[0].segments[0].start}`).count()) > 0);
  await page.locator('ol[aria-label="Ranked promos"] > li').nth(2).click();
  const sel3 = await page.waitForSelector('article[aria-label="Promo rank 3"]', { timeout: 3000 }).then(() => true, () => false);
  check("click selects #3", sel3 && (await page.locator('article[aria-label="Promo rank 3"]').count()) === 1);
  check("hash deep link", (await page.evaluate(() => location.hash)).startsWith("#/promos/P003"));
  await page.keyboard.press("ArrowDown");
  const sel4 = await page.waitForSelector('article[aria-label="Promo rank 4"]', { timeout: 3000 }).then(() => true, () => false);
  check("keyboard ArrowDown selects #4", sel4);
  await shot(page, "06-promo-detail");
  await page.click('[role=radio]:has-text("All")');
  check("All tab = all promos", (await page.locator('ol[aria-label="Ranked promos"] > li').count()) === P.length);
  await page.fill('input[type=search]', "E12");
  const e12 = P.filter((p) => p.segments.some((s: any) => s.episode === 12)).length;
  check("search E12", (await page.locator('ol[aria-label="Ranked promos"] > li').count()) === e12, `${e12}`);
  await page.fill('input[type=search]', "zzzz-no-match");
  check("no-match empty state", (await page.locator("text=No promos match these filters").count()) === 1);
  await shot(page, "07-promos-nomatch");
  await page.click("text=Reset filters");
  await page.selectOption('select[aria-label="Sort"]', "duration");
  const firstDur = await page.locator('ol[aria-label="Ranked promos"] > li').first().innerText();
  const minDur = Math.min(...P.filter((p) => p.headline).map((p) => p.totalDurationCs)) / 100;
  check("sort shortest first", firstDur.includes(`${minDur.toFixed(1)} s`), firstDur.split("\n").pop() ?? "");
  await page.selectOption('select[aria-label="Sort"]', "rank");
  await page.click('[role=radio]:has-text("Weak")');
  check("Weak tab", (await page.locator('ol[aria-label="Ranked promos"] > li').count()) === P.filter((p) => p.status === "weak").length);
  await shot(page, "08-promos-weak");

  // Candidates
  await page.click("nav >> text=All Candidates");
  await page.waitForSelector("table");
  await shot(page, "09-candidates");
  await page.click('[role=radio]:has-text("Rejected")');
  const rejectedShown = await page.locator("tbody tr").count();
  check("rejected rows shown", rejectedShown > 0, String(rejectedShown));
  await page.click('[role=radio]:has-text("Accepted")');
  await page.locator("tbody tr button").first().click();
  check("candidate link opens promo", (await page.evaluate(() => location.hash)).startsWith("#/promos/"));

  // Analytics
  await page.click("nav >> text=Analytics");
  await page.waitForSelector("text=Best promo per episode");
  await page.waitForTimeout(300);
  await shot(page, "10-analytics", true);
  check("analytics charts render", (await page.locator("main svg[role=img]").count()) >= 4, String(await page.locator("main svg[role=img]").count()));
  const bars = page.locator('svg[aria-label^="Best promo score"] rect.cursor-pointer');
  await bars.nth(11).hover();
  check("bar tooltip on hover", (await page.locator("[role=tooltip]").count()) === 1);
  await page.locator('[role=radio]:has-text("Hook")').first().click();
  check("metric switch", (await page.locator("text=Hook score distribution").count()) === 1);
  await page.locator('button:has-text("Table")').first().click();
  check("table view toggle", (await page.locator("th:has-text('Best score')").count()) === 1);
  await page.locator('button:has-text("Chart")').first().click();
  await page.locator('svg[aria-label^="Best promo score"] rect.cursor-pointer').nth(11).click();
  check("bar click filters to episode", (await page.locator("text=Episode 12").count()) > 0 && (await page.evaluate(() => location.hash)).startsWith("#/promos"));

  // Reports
  await page.click("nav >> text=Reports & Exports");
  await page.waitForSelector("text=Quality report preview");
  await shot(page, "11-reports", true);
  check("report preview has rank section", (await page.locator("text=Why these are posted first").count()) > 0);
  for (const i of [0, 1, 2]) {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator('button:has-text("Download")').nth(i).click()]);
    check(`download ${dl.suggestedFilename().split(".").pop()}`, true, dl.suggestedFilename());
  }
  check("desktop overflow", !(await overflow(page)));
  check("desktop-light console errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------------------------------------------------------------- dark mode via toggle
{
  const { page, errors } = await newPage(1440, "light");
  await page.goto(url);
  await page.click('[aria-label="Dark theme"]');
  check("dark toggle applies", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await loadSaved(page);
  await shot(page, "12-dark-overview");
  await page.click("nav >> text=Ranked Promos");
  await page.waitForSelector('ol[aria-label="Ranked promos"]');
  await shot(page, "13-dark-promos");
  await page.click("nav >> text=Analytics");
  await page.waitForSelector("text=Best promo per episode");
  await page.waitForTimeout(300);
  await shot(page, "14-dark-analytics");
  await page.reload();
  check("theme persists after reload", (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await page.click('[aria-label="System theme"]');
  check("dark console errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------------------------------------------------------------- mobile
{
  const { page, errors } = await newPage(390, "light");
  await page.goto(url);
  await loadSaved(page);
  await shot(page, "15-mobile-overview", true);
  check("mobile overview overflow", !(await overflow(page)));
  await page.click('[aria-label="Open navigation"]');
  await page.click('[role=dialog] >> text=Ranked Promos');
  await page.waitForSelector('ol[aria-label="Ranked promos"]');
  check("mobile promos overflow", !(await overflow(page)));
  await shot(page, "16-mobile-promos");
  await page.locator('ol[aria-label="Ranked promos"] > li').first().click();
  await page.waitForSelector('[role=dialog][aria-label^="Promo"]');
  await shot(page, "17-mobile-detail");
  await page.click("text=Back to list");
  const closed = await page.waitForSelector('[role=dialog][aria-label^="Promo"]', { state: "detached", timeout: 3000 }).then(() => true, () => false);
  check("mobile sheet closes", closed);
  for (const v of ["candidates", "analytics", "reports"]) {
    await page.goto(`${url}/#/${v}`);
    await page.waitForTimeout(250);
    check(`mobile ${v} overflow`, !(await overflow(page)));
  }
  await shot(page, "18-mobile-reports", true);
  check("mobile console errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---------------------------------------------------------------- heuristic run in the browser
{
  const { page, errors } = await newPage(1440, "light");
  await page.goto(url);
  await page.setInputFiles('input[aria-label="Upload a screenplay ZIP"]', zip);
  await page.waitForSelector("text=timed beats");
  await page.check('input[name=mode] >> nth=1');
  await page.click('button:has-text("Find promos in")');
  await page.waitForSelector("text=Episode coverage", { timeout: 60000 });
  check("heuristic banner", (await page.locator("text=Heuristic Mode — No AI Analysis").count()) >= 2);
  await shot(page, "19-heuristic-overview");
  check("heuristic console errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

await browser.close();
let fails = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail.slice(0, 140)})` : ""}`);
}
console.log(`\n${checks.length - fails}/${checks.length} checks passed`);
process.exit(fails ? 1 : 0);
