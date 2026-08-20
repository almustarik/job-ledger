/**
 * Node test harness for Job Ledger storage + CSV + URL normalization.
 * Mocks chrome.storage.local so we can exercise real module code.
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function createChromeMock() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...store };
          if (typeof keys === "string") return { [keys]: store[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) out[k] = store[k];
            return out;
          }
          const out = { ...keys };
          for (const k of Object.keys(keys)) {
            if (k in store) out[k] = store[k];
          }
          return out;
        },
        async set(obj) {
          Object.assign(store, obj);
        },
        async clear() {
          for (const k of Object.keys(store)) delete store[k];
        },
        _dump() {
          return store;
        },
      },
    },
  };
  return chrome.storage.local;
}

async function run() {
  const storageMock = createChromeMock();
  const storage = await import(pathToFileURL(path.join(root, "lib/storage.js")).href);
  const constants = await import(pathToFileURL(path.join(root, "lib/constants.js")).href);

  let passed = 0;
  const check = (name, fn) => {
    try {
      fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  };

  const checkAsync = async (name, fn) => {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}`);
      throw err;
    }
  };

  console.log("\nURL normalization");
  check("strips hash and trailing slash", () => {
    assert.equal(
      storage.normalizeUrl("https://jobs.example.com/role/123/#section"),
      "https://jobs.example.com/role/123"
    );
  });
  check("returns empty for empty input", () => {
    assert.equal(storage.normalizeUrl(""), "");
  });

  console.log("\nProfile");
  await checkAsync("returns defaults when empty", async () => {
    const profile = await storage.getProfile();
    assert.equal(profile.currency, "USD");
    assert.equal(profile.followUpDays, 7);
  });
  await checkAsync("saves and reloads profile", async () => {
    await storage.saveProfile({
      defaultSalary: "190000",
      currency: "USD",
      resumeVersion: "v3",
      followUpDays: 10,
    });
    const profile = await storage.getProfile();
    assert.equal(profile.defaultSalary, "190000");
    assert.equal(profile.resumeVersion, "v3");
    assert.equal(profile.followUpDays, 10);
  });

  console.log("\nApplications");
  await checkAsync("creates application with profile defaults", async () => {
    const { application, duplicate } = await storage.upsertApplication({
      company: "Acme",
      title: "Principal Engineer",
      url: "https://jobs.acme.com/pe",
      source: "linkedin",
      notes: "Said 190k base",
    });
    assert.equal(duplicate, null);
    assert.ok(application.id);
    assert.equal(application.salaryExpectation, "190000");
    assert.equal(application.resumeVersion, "v3");
    assert.equal(application.status, "applied");
    assert.ok(application.followUpAt);
    const followUp = new Date(application.followUpAt).getTime();
    const expected = Date.now() + 10 * 86400000;
    assert.ok(Math.abs(followUp - expected) < 5000);
  });

  await checkAsync("detects duplicate by normalized URL", async () => {
    const dup = await storage.findByUrl("https://jobs.acme.com/pe/");
    assert.ok(dup);
    assert.equal(dup.company, "Acme");
    const { duplicate } = await storage.upsertApplication({
      company: "Acme",
      title: "Principal Engineer",
      url: "https://jobs.acme.com/pe#apply",
    });
    assert.ok(duplicate);
    assert.equal(duplicate.company, "Acme");
  });

  await checkAsync("updates status and fields", async () => {
    const apps = await storage.getApplications();
    const first = apps.find((a) => a.url.includes("jobs.acme.com/pe") && a.notes.includes("190k"));
    assert.ok(first);
    const { application } = await storage.upsertApplication({
      id: first.id,
      status: "interview",
      salaryExpectation: "200000",
    });
    assert.equal(application.status, "interview");
    assert.equal(application.salaryExpectation, "200000");
    assert.equal(application.company, "Acme");
  });

  await checkAsync("sorts newest appliedAt first", async () => {
    await storage.upsertApplication({
      company: "Beta",
      title: "Staff Eng",
      url: "https://beta.dev/jobs/1",
      appliedAt: "2026-08-01T12:00:00.000Z",
    });
    await storage.upsertApplication({
      company: "Gamma",
      title: "Director",
      url: "https://gamma.dev/jobs/1",
      appliedAt: "2026-08-20T12:00:00.000Z",
    });
    const apps = await storage.getApplications();
    assert.ok(apps.length >= 3);
    for (let i = 1; i < apps.length; i++) {
      assert.ok(String(apps[i - 1].appliedAt) >= String(apps[i].appliedAt));
    }
  });

  await checkAsync("deletes application", async () => {
    const before = await storage.getApplications();
    const target = before.find((a) => a.company === "Beta");
    await storage.deleteApplication(target.id);
    const after = await storage.getApplications();
    assert.equal(after.some((a) => a.id === target.id), false);
    assert.equal(after.length, before.length - 1);
  });

  await checkAsync("throws when updating missing id", async () => {
    await assert.rejects(
      () => storage.upsertApplication({ id: "missing", status: "offer" }),
      /not found/i
    );
  });

  console.log("\nCSV export");
  check("escapes commas and quotes", () => {
    const csv = storage.applicationsToCsv([
      {
        company: 'Foo, "Bar"',
        title: "Eng",
        status: "applied",
        salaryExpectation: "100",
        currency: "USD",
        resumeVersion: "v1",
        source: "other",
        url: "https://x.test",
        appliedAt: "2026-01-01",
        followUpAt: "2026-01-08",
        notes: "line1\nline2",
      },
    ]);
    assert.match(csv, /company,title,status/);
    assert.match(csv, /"Foo, ""Bar"""/);
    assert.match(csv, /"line1\nline2"/);
  });

  console.log("\nConstants");
  check("has required statuses", () => {
    const ids = constants.STATUSES.map((s) => s.id);
    for (const id of ["applied", "interview", "offer", "rejected"]) {
      assert.ok(ids.includes(id));
    }
  });

  console.log("\nManifest / assets");
  const fs = await import("node:fs");
  check("manifest is valid MV3", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.side_panel.default_path, "sidepanel/index.html");
    assert.ok(manifest.permissions.includes("storage"));
    assert.ok(manifest.permissions.includes("sidePanel"));
    assert.ok(fs.existsSync(path.join(root, "icons/icon128.png")));
    assert.ok(fs.existsSync(path.join(root, "sidepanel/app.js")));
    assert.ok(fs.existsSync(path.join(root, "content/extract.js")));
  });

  check("sidepanel HTML wires required controls", () => {
    const html = fs.readFileSync(path.join(root, "sidepanel/index.html"), "utf8");
    for (const id of [
      "capture-form",
      "company",
      "title",
      "url",
      "salaryExpectation",
      "btn-fill-tab",
      "btn-export",
      "profile-form",
      "app-list",
    ]) {
      assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
    }
  });

  // Keep mock dump referenced so unused warning doesn't confuse
  assert.ok(storageMock._dump());

  console.log(`\nAll ${passed} checks passed.\n`);
}

run().catch((err) => {
  console.error("\nTEST FAILURE\n", err);
  process.exit(1);
});
