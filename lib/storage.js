import { DEFAULT_PROFILE, STORAGE_KEYS } from "./constants.js";

function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `app_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

export async function getProfile() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.profile);
  return { ...DEFAULT_PROFILE, ...(data[STORAGE_KEYS.profile] || {}) };
}

export async function saveProfile(profile) {
  const next = { ...DEFAULT_PROFILE, ...profile };
  await chrome.storage.local.set({ [STORAGE_KEYS.profile]: next });
  return next;
}

export async function getApplications() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.applications);
  const list = data[STORAGE_KEYS.applications] || [];
  return list.sort((a, b) => String(b.appliedAt).localeCompare(String(a.appliedAt)));
}

export async function findByUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return null;
  const apps = await getApplications();
  return apps.find((a) => normalizeUrl(a.url) === normalized) || null;
}

export async function upsertApplication(input) {
  const apps = await getApplications();
  const now = new Date().toISOString();
  const profile = await getProfile();

  if (input.id) {
    const idx = apps.findIndex((a) => a.id === input.id);
    if (idx === -1) throw new Error("Application not found");
    const updated = {
      ...apps[idx],
      ...input,
      url: input.url ?? apps[idx].url,
      updatedAt: now,
    };
    apps[idx] = updated;
    await chrome.storage.local.set({ [STORAGE_KEYS.applications]: apps });
    return { application: updated, duplicate: null };
  }

  const duplicate = await findByUrl(input.url);
  const followUpDays = Number(profile.followUpDays) || 7;
  const followUpAt = new Date(Date.now() + followUpDays * 86400000).toISOString();

  const application = {
    id: uid(),
    company: (input.company || "").trim(),
    title: (input.title || "").trim(),
    url: (input.url || "").trim(),
    source: input.source || "other",
    resumeVersion: (input.resumeVersion || profile.resumeVersion || "").trim(),
    salaryExpectation: (input.salaryExpectation || profile.defaultSalary || "").trim(),
    currency: (input.currency || profile.currency || "USD").trim(),
    status: input.status || "applied",
    notes: (input.notes || "").trim(),
    appliedAt: input.appliedAt || now,
    followUpAt: input.followUpAt || followUpAt,
    createdAt: now,
    updatedAt: now,
  };

  apps.unshift(application);
  await chrome.storage.local.set({ [STORAGE_KEYS.applications]: apps });
  return { application, duplicate };
}

export async function deleteApplication(id) {
  const apps = await getApplications();
  const next = apps.filter((a) => a.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.applications]: next });
}

export async function updateStatus(id, status) {
  return upsertApplication({ id, status });
}

export function applicationsToCsv(applications) {
  const headers = [
    "company",
    "title",
    "status",
    "salaryExpectation",
    "currency",
    "resumeVersion",
    "source",
    "url",
    "appliedAt",
    "followUpAt",
    "notes",
  ];

  const escape = (value) => {
    const s = value == null ? "" : String(value);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const rows = applications.map((app) =>
    headers.map((h) => escape(app[h])).join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

export { normalizeUrl };
