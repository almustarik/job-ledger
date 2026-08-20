import {
  STATUSES,
  SOURCES,
} from "../lib/constants.js";
import {
  getApplications,
  getProfile,
  saveProfile,
  upsertApplication,
  deleteApplication,
  findByUrl,
  applicationsToCsv,
} from "../lib/storage.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  applications: [],
  profile: null,
  editingId: null,
  selectedId: null,
};

function fillSelect(el, options, includeEmpty = false) {
  el.innerHTML = "";
  if (includeEmpty) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "—";
    el.appendChild(opt);
  }
  for (const item of options) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = item.label;
    el.appendChild(opt);
  }
}

function todayInputValue(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function showBanner(el, message, ms = 3200) {
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || "";
  if (message && ms) {
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.hidden = true;
      el.textContent = "";
    }, ms);
  }
}

function switchView(view) {
  $$(".tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });
  $$(".view").forEach((section) => {
    const active = section.id === `view-${view}`;
    section.classList.toggle("is-active", active);
    section.hidden = !active;
  });
}

async function loadAll() {
  state.profile = await getProfile();
  state.applications = await getApplications();
  renderPipeline();
}

function applyProfileDefaults() {
  if (!state.profile) return;
  if (!$("#edit-id").value) {
    $("#salaryExpectation").value = state.profile.defaultSalary || "";
    $("#currency").value = state.profile.currency || "USD";
    $("#resumeVersion").value = state.profile.resumeVersion || "";
  }
}

function resetCaptureForm({ keepDefaults = true } = {}) {
  $("#capture-form").reset();
  $("#edit-id").value = "";
  state.editingId = null;
  $("#appliedAt").value = todayInputValue();
  $("#status").value = "applied";
  $("#source").value = "other";
  $("#btn-save").textContent = "Save application";
  showBanner($("#duplicate-warning"), "");
  showBanner($("#form-message"), "", 0);
  if (keepDefaults) applyProfileDefaults();
}

function populateForm(app) {
  $("#edit-id").value = app.id || "";
  state.editingId = app.id || null;
  $("#company").value = app.company || "";
  $("#title").value = app.title || "";
  $("#url").value = app.url || "";
  $("#source").value = app.source || "other";
  $("#status").value = app.status || "applied";
  $("#resumeVersion").value = app.resumeVersion || "";
  $("#salaryExpectation").value = app.salaryExpectation || "";
  $("#currency").value = app.currency || "USD";
  $("#appliedAt").value = todayInputValue(app.appliedAt);
  $("#notes").value = app.notes || "";
  $("#btn-save").textContent = app.id ? "Update application" : "Save application";
}

async function checkDuplicate() {
  const url = $("#url").value.trim();
  const warning = $("#duplicate-warning");
  if (!url || state.editingId) {
    showBanner(warning, "", 0);
    return;
  }
  const existing = await findByUrl(url);
  if (existing) {
    showBanner(
      warning,
      `Already tracked: ${existing.company || "Unknown"} — ${existing.title || "Untitled"} (${existing.status}). Saving will add another entry.`,
      0
    );
  } else {
    showBanner(warning, "", 0);
  }
}

async function extractFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  let extracted = {
    company: "",
    title: (tab.title || "").replace(/\s*[|\-–].*$/, "").trim(),
    url: tab.url || "",
    source: "other",
  };

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_JOB" });
    if (response) extracted = { ...extracted, ...response };
  } catch {
    // Content script may be missing on chrome:// or before injection.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content/extract.js"],
      });
      const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_JOB" });
      if (response) extracted = { ...extracted, ...response };
    } catch {
      // Fall back to tab metadata only.
    }
  }

  if (!extracted.url && tab.url) extracted.url = tab.url;
  return extracted;
}

async function fillFromTab() {
  try {
    const data = await extractFromActiveTab();
    if (!$("#edit-id").value) applyProfileDefaults();
    if (data.company) $("#company").value = data.company;
    if (data.title) $("#title").value = data.title;
    if (data.url) $("#url").value = data.url;
    if (data.source) $("#source").value = data.source;
    await checkDuplicate();
    showBanner($("#form-message"), "Filled from the active tab. Review and save.");
  } catch (err) {
    showBanner($("#form-message"), err.message || "Could not read the active tab.");
  }
}

function statusLabel(id) {
  return STATUSES.find((s) => s.id === id)?.label || id;
}

function sourceLabel(id) {
  return SOURCES.find((s) => s.id === id)?.label || id;
}

function isFollowUpDue(app) {
  if (!app.followUpAt) return false;
  if (["offer", "rejected", "ghosted"].includes(app.status)) return false;
  return new Date(app.followUpAt).getTime() <= Date.now();
}

function filteredApplications() {
  const q = ($("#search").value || "").trim().toLowerCase();
  const status = $("#filter-status").value;
  return state.applications.filter((app) => {
    if (status !== "all" && app.status !== status) return false;
    if (!q) return true;
    const hay = [app.company, app.title, app.notes, app.url, app.resumeVersion]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function renderPipeline() {
  const list = $("#app-list");
  const empty = $("#pipeline-empty");
  const apps = filteredApplications();
  list.innerHTML = "";
  empty.hidden = apps.length > 0;

  for (const app of apps) {
    const li = document.createElement("li");
    li.className = "app-item";
    li.dataset.id = app.id;

    const salary =
      app.salaryExpectation
        ? `${app.currency || ""} ${app.salaryExpectation}`.trim()
        : "No salary set";

    li.innerHTML = `
      <div class="app-item-top">
        <div>
          <h3>${escapeHtml(app.title || "Untitled role")}</h3>
          <p class="meta">${escapeHtml(app.company || "Unknown company")} · ${escapeHtml(salary)}</p>
        </div>
      </div>
      <div class="chips">
        <span class="chip status-${escapeAttr(app.status)}">${escapeHtml(statusLabel(app.status))}</span>
        <span class="chip">${escapeHtml(sourceLabel(app.source))}</span>
        ${app.resumeVersion ? `<span class="chip">${escapeHtml(app.resumeVersion)}</span>` : ""}
        ${isFollowUpDue(app) ? `<span class="chip due">Follow up</span>` : ""}
      </div>
    `;

    li.addEventListener("click", () => openDetail(app.id));
    list.appendChild(li);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "");
}

function openDetail(id) {
  const app = state.applications.find((a) => a.id === id);
  if (!app) return;
  state.selectedId = id;

  $("#detail-heading").textContent = app.company || "Application";
  const body = $("#detail-body");
  body.innerHTML = `
    <dl class="detail-row"><dt>Role</dt><dd>${escapeHtml(app.title || "—")}</dd></dl>
    <dl class="detail-row"><dt>Status</dt><dd>
      <select id="detail-status" class="status-select">
        ${STATUSES.map((s) => `<option value="${s.id}" ${s.id === app.status ? "selected" : ""}>${s.label}</option>`).join("")}
      </select>
    </dd></dl>
    <dl class="detail-row"><dt>Salary</dt><dd>${escapeHtml(`${app.currency || ""} ${app.salaryExpectation || "—"}`.trim())}</dd></dl>
    <dl class="detail-row"><dt>Resume</dt><dd>${escapeHtml(app.resumeVersion || "—")}</dd></dl>
    <dl class="detail-row"><dt>Source</dt><dd>${escapeHtml(sourceLabel(app.source))}</dd></dl>
    <dl class="detail-row"><dt>Applied</dt><dd>${escapeHtml(todayInputValue(app.appliedAt) || "—")}</dd></dl>
    <dl class="detail-row"><dt>Follow-up</dt><dd>${escapeHtml(todayInputValue(app.followUpAt) || "—")}${isFollowUpDue(app) ? " · due" : ""}</dd></dl>
    <dl class="detail-row"><dt>URL</dt><dd>${app.url ? `<a href="${escapeAttr(app.url)}" target="_blank" rel="noreferrer">${escapeHtml(app.url)}</a>` : "—"}</dd></dl>
    <dl class="detail-row"><dt>Notes</dt><dd>${escapeHtml(app.notes || "—")}</dd></dl>
  `;

  $("#detail-status").addEventListener("change", async (e) => {
    await upsertApplication({ id: app.id, status: e.target.value });
    await loadAll();
  });

  $("#detail-dialog").showModal();
}

async function onSaveCapture(event) {
  event.preventDefault();
  const id = $("#edit-id").value || undefined;
  const appliedDate = $("#appliedAt").value;
  const appliedAt = appliedDate
    ? new Date(`${appliedDate}T12:00:00`).toISOString()
    : new Date().toISOString();

  const payload = {
    id,
    company: $("#company").value,
    title: $("#title").value,
    url: $("#url").value,
    source: $("#source").value,
    status: $("#status").value,
    resumeVersion: $("#resumeVersion").value,
    salaryExpectation: $("#salaryExpectation").value,
    currency: $("#currency").value,
    notes: $("#notes").value,
    appliedAt,
  };

  try {
    const { application } = await upsertApplication(payload);
    await loadAll();
    resetCaptureForm();
    showBanner(
      $("#form-message"),
      id ? `Updated ${application.company}.` : `Saved ${application.company} — ${application.title}.`
    );
  } catch (err) {
    showBanner($("#form-message"), err.message || "Save failed.");
  }
}

function renderProfileForm() {
  const p = state.profile;
  $("#profile-salary").value = p.defaultSalary || "";
  $("#profile-currency").value = p.currency || "USD";
  $("#profile-resume").value = p.resumeVersion || "";
  $("#profile-notice").value = p.noticePeriod || "";
  $("#profile-followup").value = p.followUpDays ?? 7;
  $("#profile-workauth").value = p.workAuth || "";
  $("#profile-locations").value = p.preferredLocations || "";
}

async function onSaveProfile(event) {
  event.preventDefault();
  state.profile = await saveProfile({
    defaultSalary: $("#profile-salary").value,
    currency: $("#profile-currency").value,
    resumeVersion: $("#profile-resume").value,
    noticePeriod: $("#profile-notice").value,
    followUpDays: Number($("#profile-followup").value) || 7,
    workAuth: $("#profile-workauth").value,
    preferredLocations: $("#profile-locations").value,
  });
  applyProfileDefaults();
  showBanner($("#profile-message"), "Profile saved. New captures will use these defaults.");
}

function exportCsv() {
  const csv = applicationsToCsv(state.applications);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `job-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function wireEvents() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      switchView(tab.dataset.view);
      if (tab.dataset.view === "pipeline") renderPipeline();
      if (tab.dataset.view === "profile") renderProfileForm();
    });
  });

  $("#capture-form").addEventListener("submit", onSaveCapture);
  $("#btn-reset").addEventListener("click", () => resetCaptureForm());
  $("#btn-fill-tab").addEventListener("click", fillFromTab);
  $("#url").addEventListener("change", checkDuplicate);
  $("#url").addEventListener("blur", checkDuplicate);

  $("#search").addEventListener("input", renderPipeline);
  $("#filter-status").addEventListener("change", renderPipeline);
  $("#btn-export").addEventListener("click", exportCsv);

  $("#profile-form").addEventListener("submit", onSaveProfile);

  $("#detail-edit").addEventListener("click", () => {
    const app = state.applications.find((a) => a.id === state.selectedId);
    if (!app) return;
    populateForm(app);
    $("#detail-dialog").close();
    switchView("capture");
  });

  $("#detail-delete").addEventListener("click", async () => {
    if (!state.selectedId) return;
    if (!confirm("Delete this application?")) return;
    await deleteApplication(state.selectedId);
    state.selectedId = null;
    $("#detail-dialog").close();
    await loadAll();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.applications || changes.profile)) {
      loadAll().then(() => {
        if (!$("#edit-id").value) applyProfileDefaults();
      });
    }
  });
}

async function init() {
  fillSelect($("#source"), SOURCES);
  fillSelect($("#status"), STATUSES);
  fillSelect($("#filter-status"), [{ id: "all", label: "All statuses" }, ...STATUSES]);

  wireEvents();
  await loadAll();
  resetCaptureForm();
  renderProfileForm();

  // Auto-fill from the active tab when opening Capture.
  try {
    await fillFromTab();
  } catch {
    // Ignore on restricted pages.
  }
}

init();
