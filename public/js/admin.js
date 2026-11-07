"use strict";
// Admin review page. Talks to /api/admin/* (protected by Cloudflare Access).

const REASONS = {
  remove: "Should not be on this list",
  move: "Wrong type or section",
  "broken-link": "Broken or changed link",
  citation: "Citation needs a fix",
  other: "Other",
};

const admin = {
  types: [],
  typeLabel: {},
  resources: [],
  tab: "pending",
};

const list = document.getElementById("admin-list");
const statusEl = document.getElementById("admin-status");
const toolbar = document.getElementById("admin-toolbar");
const entrySearch = document.getElementById("entry-search");

init();

async function init() {
  try {
    const config = await fetch("/api/config").then((r) => r.json());
    admin.types = config.types;
    admin.defaultSections = config.defaultSections || {};
    admin.typeLabel = Object.fromEntries(admin.types.map((t) => [t.id, t.label]));
    await loadResources();
  } catch (err) {
    return showStatus(err.message, "error");
  }

  for (const tab of document.querySelectorAll("[data-tab]")) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  }
  entrySearch.addEventListener("input", renderEntries);
  document.getElementById("add-entry").addEventListener("click", () => {
    list.prepend(entryCard(null));
  });
  switchTab("pending");
}

async function api(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Not signed in. Reload the page to sign in through Cloudflare Access.");
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadResources() {
  admin.resources = await api("/resources");
}

function showStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `form-status ${kind}`.trim();
}

function switchTab(tab) {
  admin.tab = tab;
  for (const el of document.querySelectorAll("[data-tab]")) {
    el.setAttribute("aria-selected", String(el.dataset.tab === tab));
  }
  toolbar.hidden = tab !== "entries";
  showStatus("");
  if (tab === "entries") renderEntries();
  else loadSubmissions(tab);
}

// ---------- submissions ----------

async function loadSubmissions(status) {
  list.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const subs = await api(`/submissions?status=${status}`);
    if (status === "pending") {
      document.getElementById("pending-count").textContent = subs.length ? `(${subs.length})` : "";
    }
    list.replaceChildren();
    if (!subs.length) {
      list.innerHTML = `<p class="empty">No ${status} submissions.</p>`;
      return;
    }
    for (const sub of subs) list.append(submissionCard(sub));
  } catch (err) {
    list.replaceChildren();
    showStatus(err.message, "error");
  }
}

function submissionCard(sub) {
  const card = el("article", "entry admin-card");
  const pending = sub.status === "pending";
  const p = sub.payload || {};

  const head = el("div", "admin-card-head");
  const kind = el("span", `kind-badge kind-${sub.kind}`, sub.kind === "suggest" ? "Suggestion" : "Report");
  const title = el("h3", "", sub.kind === "suggest" ? p.title : (sub.current?.title || p.title || sub.resource_id));
  const when = el("span", "muted small", `#${sub.id} · ${formatDate(sub.created_at)}`);
  head.append(kind, title, when);
  card.append(head);

  if (sub.kind === "report") {
    card.append(infoRow("Reason", REASONS[sub.reason] || sub.reason));
    if (p.details) card.append(infoRow("Details", p.details));
    if (sub.current) card.append(changesTable(sub.current, p));
    else card.append(infoRow("Entry", `${sub.resource_id} (no longer exists)`));
  }
  if (sub.note) card.append(infoRow("Note to reviewer", sub.note));

  if (!pending) {
    card.append(el("p", "muted small", `${sub.status} ${formatDate(sub.reviewed_at)}`));
    return card;
  }

  // Editor: suggestion values, or the current entry with the proposed changes applied.
  let start = null;
  if (sub.kind === "suggest") start = p;
  else if (sub.current) {
    start = { ...sub.current };
    for (const k of ["type", "section", "url", "citation"]) if (p[k]) start[k] = p[k];
  }

  const editor = start ? buildEditor(start) : null;
  if (editor) card.append(editor.node);

  const actions = el("div", "modal-actions");
  const status = el("p", "form-status");
  const busy = (on) => actions.querySelectorAll("button").forEach((b) => { b.disabled = on; });

  const run = async (fn, doneText) => {
    busy(true);
    status.textContent = "Saving…";
    status.className = "form-status";
    try {
      await fn();
      await loadResources();
      card.replaceChildren(el("p", "form-status success", doneText));
      setTimeout(() => card.remove(), 1500);
      updatePendingCount(-1);
    } catch (err) {
      status.textContent = err.message;
      status.className = "form-status error";
      busy(false);
    }
  };

  actions.append(button("Reject", "btn-ghost", () =>
    run(() => api(`/submissions/${sub.id}/reject`, { method: "POST", body: "{}" }), "Rejected."),
  ));

  if (sub.kind === "report" && sub.current) {
    actions.append(button("Hide entry", sub.reason === "remove" ? "btn-danger" : "", () => {
      if (!confirm(`Hide "${sub.current.title}" from the site?`)) return;
      run(() => api(`/submissions/${sub.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ action: "hide" }),
      }), "Entry hidden.");
    }));
  }

  if (editor) {
    const label = sub.kind === "suggest" ? "Approve & publish" : "Save changes";
    actions.append(button(label, "btn-primary", () => {
      const values = editor.values();
      const problem = checkValues(values);
      if (problem) {
        status.textContent = problem;
        status.className = "form-status error";
        return;
      }
      run(() => api(`/submissions/${sub.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ action: "save", resource: values }),
      }), sub.kind === "suggest" ? "Published." : "Entry updated.");
    }));
  }

  card.append(status, actions);
  return card;
}

function changesTable(current, proposed) {
  const rows = [];
  if (proposed.type && proposed.type !== current.type) {
    rows.push(["Type", admin.typeLabel[current.type] || current.type, admin.typeLabel[proposed.type] || proposed.type]);
  }
  if (proposed.section && proposed.section !== current.section) rows.push(["Section", current.section, proposed.section]);
  if (proposed.url && proposed.url !== current.url) rows.push(["Link", current.url || "(none)", proposed.url]);
  if (proposed.citation && proposed.citation !== current.citation) rows.push(["Citation", current.citation, proposed.citation]);
  if (!rows.length) return el("p", "muted small", "No specific field changes proposed.");

  const table = el("table", "diff");
  table.innerHTML = "<thead><tr><th></th><th>Current</th><th>Proposed</th></tr></thead>";
  const tbody = el("tbody");
  for (const [label, from, to] of rows) {
    const tr = el("tr");
    tr.append(el("th", "", label), el("td", "diff-old", from), el("td", "diff-new", to));
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function updatePendingCount(delta) {
  const elCount = document.getElementById("pending-count");
  const n = Math.max(0, (parseInt(elCount.textContent.replace(/\D/g, ""), 10) || 0) + delta);
  elCount.textContent = n ? `(${n})` : "";
}

// ---------- entries ----------

function renderEntries() {
  const q = entrySearch.value.trim().toLowerCase();
  const rows = admin.resources.filter((r) =>
    !q || [r.title, r.section, r.citation, r.id].join(" ").toLowerCase().includes(q),
  );
  list.replaceChildren();
  if (!rows.length) {
    list.innerHTML = '<p class="empty">No entries.</p>';
    return;
  }
  for (const r of rows.slice(0, 200)) list.append(entryCard(r));
  if (rows.length > 200) list.append(el("p", "muted small", `Showing 200 of ${rows.length}. Search to narrow down.`));
}

function entryCard(r) {
  const card = el("article", "entry admin-card");
  const head = el("div", "admin-card-head");
  head.append(el("h3", "", r ? r.title : "New entry"));
  if (r && r.status === "hidden") head.append(el("span", "kind-badge kind-report", "Hidden"));
  if (r) head.append(el("span", "muted small", `${admin.typeLabel[r.type] || r.type} · ${r.section}`));
  card.append(head);

  let editor = null;
  const actions = el("div", "modal-actions");
  const status = el("p", "form-status");

  const save = async (statusValue) => {
    const values = editor.values();
    const problem = checkValues(values);
    if (problem) {
      status.textContent = problem;
      status.className = "form-status error";
      return;
    }
    status.textContent = "Saving…";
    status.className = "form-status";
    try {
      if (r) {
        await api(`/resources/${r.id}`, { method: "PUT", body: JSON.stringify({ ...values, status: statusValue }) });
      } else {
        await api("/resources", { method: "POST", body: JSON.stringify(values) });
      }
      await loadResources();
      renderEntries();
      showStatus("Saved.", "success");
    } catch (err) {
      status.textContent = err.message;
      status.className = "form-status error";
    }
  };

  const openEditor = () => {
    editor = buildEditor(r || {});
    actions.replaceChildren();
    if (r) {
      const hidden = r.status === "hidden";
      actions.append(button(hidden ? "Unhide" : "Hide", hidden ? "" : "btn-danger", () => save(hidden ? "published" : "hidden")));
      actions.append(button("Cancel", "btn-ghost", () => card.replaceWith(entryCard(r))));
    } else {
      actions.append(button("Cancel", "btn-ghost", () => card.remove()));
    }
    actions.append(button(r ? "Save" : "Add entry", "btn-primary", () => save(r?.status || "published")));
    card.append(editor.node, status, actions);
  };

  if (r) {
    const preview = el("p", "citation");
    preview.innerHTML = formatCitation(r.citation);
    card.append(preview);
    const editBtn = button("Edit", "", () => {
      preview.remove();
      editBtn.remove();
      openEditor();
    });
    card.append(editBtn);
  } else {
    openEditor();
  }
  return card;
}

// ---------- editor ----------

function buildEditor(values) {
  const node = document.getElementById("editor-template").content.firstElementChild.cloneNode(true);
  const q = (name) => node.querySelector(`[name="${name}"]`);
  const type = q("type");
  const sectionSelect = q("sectionSelect");
  const sectionOther = q("sectionOther");

  fillTypeSelect(type, admin.types);
  type.value = values.type || admin.types[0].id;

  const refreshSections = (current) =>
    fillSectionSelect(sectionSelect, sectionsFor(admin.resources, type.value, admin.defaultSections), {
      placeholder: "Choose a section…",
      otherInput: sectionOther,
      current,
    });
  refreshSections(values.section);
  type.addEventListener("change", () => refreshSections(sectionValue(sectionSelect, sectionOther)));
  sectionSelect.addEventListener("change", () => toggleOther(sectionSelect, sectionOther));

  q("title").value = values.title || "";
  q("url").value = values.url || "";
  q("description").value = values.description || "";
  q("citation").value = values.citation || "";
  q("citation_approximate").checked = Boolean(values.citation_approximate);
  wireCitationPreview(q("citation"), node.querySelector(".citation-preview"));

  return {
    node,
    values: () => ({
      type: type.value,
      section: sectionValue(sectionSelect, sectionOther),
      title: q("title").value.trim(),
      url: q("url").value.trim(),
      description: q("description").value.trim(),
      citation: q("citation").value.trim(),
      citation_approximate: q("citation_approximate").checked,
    }),
  };
}

function checkValues(v) {
  if (!v.section) return "Choose or enter a section.";
  if (!v.title) return "Title is required.";
  if (v.url && !/^https?:\/\//i.test(v.url)) return "Links must start with http:// or https://.";
  if (!v.description) return "Description is required.";
  if (!v.citation) return "Citation is required.";
  return null;
}

// ---------- tiny DOM helpers ----------

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, extraClass, onClick) {
  const b = el("button", `btn ${extraClass}`.trim(), text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function infoRow(label, value) {
  const p = el("p", "info-row");
  p.append(el("strong", "", `${label}: `), document.createTextNode(value));
  return p;
}

function formatDate(sqlDate) {
  if (!sqlDate) return "";
  const d = new Date(`${sqlDate.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? sqlDate : d.toLocaleString();
}
