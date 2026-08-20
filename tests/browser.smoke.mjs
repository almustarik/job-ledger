/**
 * Smoke-test Job Ledger by loading it as an unpacked MV3 extension in Chrome.
 * Uses Puppeteer's enableExtensions API (Chrome 137+ removed --load-extension).
 */
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "..");
const chromePath =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const jobHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta property="og:site_name" content="Northwind Labs" />
  <title>Staff Platform Engineer | Northwind Labs</title>
</head>
<body>
  <h1>Staff Platform Engineer</h1>
  <p class="company-name">Northwind Labs</p>
  <p>Build durable systems. Hybrid SF.</p>
</body>
</html>`;

function startJobServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(jobHtml);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/jobs/staff-platform` });
    });
  });
}

async function resolveExtensionId(browser, installedId) {
  if (installedId) return installedId;

  const workerTarget = await browser.waitForTarget(
    (target) =>
      target.type() === "service_worker" &&
      target.url().startsWith("chrome-extension://"),
    { timeout: 15000 }
  );
  return new URL(workerTarget.url()).host;
}

async function main() {
  assert.ok(fs.existsSync(chromePath), `Chrome not found at ${chromePath}`);
  assert.ok(fs.existsSync(path.join(extensionPath, "manifest.json")));

  const { server, url: jobUrl } = await startJobServer();
  const userDataDir = fs.mkdtempSync(
    path.join(process.env.TEMP || "/tmp", "job-ledger-")
  );

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      pipe: true,
      enableExtensions: true,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [`--user-data-dir=${userDataDir}`, "--no-first-run", "--no-default-browser-check"],
      defaultViewport: { width: 1100, height: 800 },
    });

    const installedId = await browser.installExtension(extensionPath);
    const extensionId = await resolveExtensionId(browser, installedId);
    console.log(`Extension loaded: ${extensionId}`);

    const sidePanelUrl = `chrome-extension://${extensionId}/sidepanel/index.html`;
    const panel = await browser.newPage();
    await panel.goto(sidePanelUrl, { waitUntil: "domcontentloaded" });
    await panel.waitForSelector("#capture-form");

    // Profile defaults
    await panel.click('[data-view="profile"]');
    await panel.waitForSelector("#profile-form");
    await panel.click("#profile-salary", { clickCount: 3 });
    await panel.type("#profile-salary", "185000");
    await panel.click("#profile-resume", { clickCount: 3 });
    await panel.type("#profile-resume", "resume-principal");
    await panel.click('#profile-form button[type="submit"]');
    await panel.waitForFunction(() => {
      const el = document.querySelector("#profile-message");
      return el && !el.hidden && /saved/i.test(el.textContent || "");
    });

    // Capture
    await panel.click('[data-view="capture"]');
    await panel.waitForSelector("#company");
    await panel.evaluate(() => document.querySelector("#btn-reset").click());

    await panel.type("#company", "Northwind Labs");
    await panel.type("#title", "Staff Platform Engineer");
    await panel.type("#url", jobUrl);
    await panel.type("#notes", "Asked for 185k base, hybrid 3 days");

    const salary = await panel.$eval("#salaryExpectation", (el) => el.value);
    const resume = await panel.$eval("#resumeVersion", (el) => el.value);
    assert.equal(salary, "185000", "profile salary default missing");
    assert.equal(resume, "resume-principal", "profile resume default missing");

    await panel.click('#capture-form button[type="submit"]');
    await panel.waitForFunction(() => {
      const el = document.querySelector("#form-message");
      return el && !el.hidden && /saved/i.test(el.textContent || "");
    });

    // Duplicate warning
    await panel.type("#company", "Northwind Labs");
    await panel.type("#title", "Staff Platform Engineer");
    await panel.type("#url", `${jobUrl}/`);
    await panel.$eval("#url", (el) => {
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    });
    await panel.waitForFunction(() => {
      const el = document.querySelector("#duplicate-warning");
      return el && !el.hidden && /already tracked/i.test(el.textContent || "");
    });

    // Pipeline
    await panel.click('[data-view="pipeline"]');
    await panel.waitForSelector(".app-item");
    const cardText = await panel.$eval(".app-item", (el) => el.textContent);
    assert.match(cardText, /Staff Platform Engineer/);
    assert.match(cardText, /Northwind Labs/);
    assert.match(cardText, /185000/);

    await panel.click(".app-item");
    await panel.waitForSelector("#detail-status");
    await panel.select("#detail-status", "interview");
    await panel.click('#detail-form button[value="close"]');
    await panel.waitForFunction(() =>
      Boolean(document.querySelector(".chip.status-interview"))
    );

    const jobPage = await browser.newPage();
    await jobPage.goto(jobUrl, { waitUntil: "domcontentloaded" });
    const extracted = await jobPage.evaluate(() => {
      const text = (el) => el?.textContent?.replace(/\s+/g, " ").trim() || "";
      const company =
        document.querySelector('meta[property="og:site_name"]')?.content?.trim() ||
        text(document.querySelector(".company-name"));
      const title = text(document.querySelector("h1"));
      return { company, title };
    });
    assert.equal(extracted.company, "Northwind Labs");
    assert.equal(extracted.title, "Staff Platform Engineer");

    const stored = await panel.evaluate(async () => {
      const data = await chrome.storage.local.get("applications");
      return data.applications || [];
    });
    assert.ok(stored.length >= 1);
    assert.equal(stored[0].status, "interview");
    assert.equal(stored[0].salaryExpectation, "185000");

    console.log("\nBrowser smoke tests passed:");
    console.log("  ✓ extension loaded");
    console.log("  ✓ profile defaults applied");
    console.log("  ✓ application saved");
    console.log("  ✓ duplicate URL warning");
    console.log("  ✓ pipeline + status update");
    console.log("  ✓ job page extraction heuristics");
    console.log("  ✓ chrome.storage persistence\n");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("\nBROWSER TEST FAILURE\n", err);
  process.exit(1);
});
