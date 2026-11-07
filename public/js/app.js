"use strict";
// Public site: search/filter published resources, suggest new ones, report entries.

const state = {
  resources: [],
  types: [],
  typeLabel: {},
  siteKey: "",
  widgets: new Map(), // form id -> Turnstile widget id
  reporting: null,    // resource being reported
};

const $ = (id) => document.getElementById(id);
const els = {
  search: $("search"),
  type: $("filter-type"),
  section: $("filter-section"),
  clear: $("clear-filters"),
  count: $("result-count"),
  results: $("results"),
  suggestDialog: $("suggest-dialog"),
  suggestForm: $("suggest-form"),
  reportDialog: $("report-dialog"),
  reportForm: $("report-form"),
  reportEntryName: $("report-entry-name"),
};

init();

async function init() {
  try {
    const [config, resources] = await Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/resources").then((r) => {
        if (!r.ok) throw new Error(`resources ${r.status}`);
        return r.json();
      }),
    ]);
    state.siteKey = config.turnstileSiteKey || "";
    state.types = config.types || [];
    state.typeLabel = Object.fromEntries(state.types.map((t) => [t.id, t.label]));
    state.resources = resources;
  } catch (err) {
    console.error(err);
    els.results.innerHTML = '<p class="empty">Could not load resources. Please refresh the page.</p>';
    return;
  }

  fillTypeSelect(els.type, state.types, "All types");
  readUrlState();
  wireFilters();
  wireSuggestForm();
  wireReportForm();
  render();
}

// ---------- filters ----------

function refreshSectionFilter(current) {
  fillSectionSelect(els.section, sectionsFor(state.resources, els.type.value), {
    placeholder: "All sections",
    current,
  });
}

function readUrlState() {
  const p = new URLSearchParams(location.search);
  els.search.value = p.get("q") || "";
  const type = p.get("type");
  if (type && state.typeLabel[type]) els.type.value = type;
  refreshSectionFilter(p.get("section"));
}

function writeUrlState() {
  const p = new URLSearchParams();
  if (els.search.value.trim()) p.set("q", els.search.value.trim());
  if (els.type.value) p.set("type", els.type.value);
  if (els.section.value) p.set("section", els.section.value);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function wireFilters() {
  let timer;
  els.search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  els.type.addEventListener("change", () => {
    refreshSectionFilter(els.section.value);
    render();
  });
  els.section.addEventListener("change", render);
  els.clear.addEventListener("click", () => {
    els.search.value = "";
    els.type.value = "";
    refreshSectionFilter("");
    render();
  });
}

function matches(r, q, type, section) {
  if (type && r.type !== type) return false;
  if (section && r.section !== section) return false;
  if (q) {
    const hay = [r.title, r.citation, r.description, r.section, state.typeLabel[r.type]]
      .join(" ")
      .toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

// ---------- rendering ----------

function render() {
  writeUrlState();
  const q = els.search.value.trim().toLowerCase();
  const list = state.resources.filter((r) => matches(r, q, els.type.value, els.section.value));
  const total = state.resources.length;

  els.count.textContent =
    list.length === total
      ? `${total} resource${total === 1 ? "" : "s"}`
      : `Showing ${list.length} of ${total} resources`;

  els.results.replaceChildren();
  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = total
      ? "No resources match. Try a different search or clear the filters."
      : "No resources yet.";
    els.results.append(p);
    return;
  }

  // Group by type (in the fixed type order), then by section.
  for (const t of state.types) {
    const ofType = list.filter((r) => r.type === t.id);
    if (!ofType.length) continue;

    const typeBlock = document.createElement("section");
    typeBlock.className = "type-group";
    const h2 = document.createElement("h2");
    h2.textContent = t.label;
    typeBlock.append(h2);

    for (const section of uniqueSorted(ofType.map((r) => r.section))) {
      const h3 = document.createElement("h3");
      h3.className = "section-heading";
      h3.textContent = section;
      typeBlock.append(h3);
      ofType
        .filter((r) => r.section === section)
        .sort((a, b) => a.title.localeCompare(b.title))
        .forEach((r) => typeBlock.append(renderEntry(r)));
    }
    els.results.append(typeBlock);
  }
}

function renderEntry(r) {
  const article = document.createElement("article");
  article.className = "entry";
  article.id = `entry-${r.id}`;

  const title = document.createElement("h4");
  if (r.url) {
    const a = document.createElement("a");
    a.href = r.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = r.title;
    title.append(a);
  } else {
    title.textContent = r.title;
  }

  const desc = document.createElement("p");
  desc.className = "description";
  desc.textContent = r.description;

  const citation = document.createElement("p");
  citation.className = "citation";
  citation.innerHTML = formatCitation(r.citation);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.append(chip(state.typeLabel[r.type] || r.type, () => {
    els.type.value = r.type;
    refreshSectionFilter("");
    render();
  }));
  meta.append(chip(r.section, () => {
    els.type.value = r.type;
    refreshSectionFilter(r.section);
    render();
  }));
  if (r.citation_approximate) {
    const badge = document.createElement("span");
    badge.className = "badge-approx";
    badge.textContent = "Citation approximate";
    badge.title = "Some citation details may be incomplete.";
    meta.append(badge);
  }

  const actions = document.createElement("div");
  actions.className = "entry-actions";
  const copyBtn = smallButton("Copy citation", async () => {
    try {
      await navigator.clipboard.writeText(stripMarkup(r.citation));
      copyBtn.textContent = "Copied";
    } catch {
      copyBtn.textContent = "Copy failed";
    }
    setTimeout(() => { copyBtn.textContent = "Copy citation"; }, 1500);
  });
  actions.append(copyBtn, smallButton("Report", () => openReport(r)));
  meta.append(actions);

  article.append(title, desc, citation, meta);
  return article;
}

function chip(text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.textContent = text;
  b.title = `Show only: ${text}`;
  b.addEventListener("click", onClick);
  return b;
}

function smallButton(text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn-small btn-ghost";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

// ---------- suggest form ----------

function wireSuggestForm() {
  const form = els.suggestForm;
  const f = form.elements;
  fillTypeSelect(f.type, state.types, "Choose a type…");
  const refreshSections = () =>
    fillSectionSelect(f.sectionSelect, sectionsFor(state.resources, f.type.value), {
      placeholder: f.type.value ? "Choose a section…" : "Choose a type first",
      otherInput: f.sectionOther,
    });
  refreshSections();
  f.type.addEventListener("change", refreshSections);
  f.sectionSelect.addEventListener("change", () => toggleOther(f.sectionSelect, f.sectionOther));
  const updatePreview = wireCitationPreview(f.citation, form.querySelector(".citation-preview"));

  $("suggest-btn").addEventListener("click", () => {
    if (form.dataset.done) {
      form.reset();
      refreshSections();
      updatePreview();
      delete form.dataset.done;
    }
    openDialog(els.suggestDialog, form);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fields = {
      type: f.type.value,
      section: sectionValue(f.sectionSelect, f.sectionOther),
      title: f.title.value.trim(),
      url: f.url.value.trim(),
      description: f.description.value.trim(),
      citation: f.citation.value.trim(),
      citation_approximate: f.citation_approximate.checked,
      note: f.note.value.trim(),
    };
    let problem = null;
    if (!fields.type) problem = "Please choose a type.";
    else if (!fields.section) problem = "Please choose or enter a section.";
    else if (!fields.title) problem = "Please enter a title.";
    else if (fields.url && !/^https?:\/\//i.test(fields.url)) problem = "Links must start with http:// or https://.";
    else if (!fields.description) problem = "Please enter a short description.";
    else if (!fields.citation) problem = "Please enter an APA 7 citation.";
    if (problem) return setStatus(form, problem, "error");
    send(form, "suggest", fields);
  });

  bindClose(els.suggestDialog);
}

// ---------- report form ----------

function wireReportForm() {
  const form = els.reportForm;
  const f = form.elements;
  fillTypeSelect(f.type, state.types);
  const refreshSections = (current) =>
    fillSectionSelect(f.sectionSelect, sectionsFor(state.resources, f.type.value), {
      placeholder: "Choose a section…",
      otherInput: f.sectionOther,
      current,
    });
  f.type.addEventListener("change", () => refreshSections(""));
  f.sectionSelect.addEventListener("change", () => toggleOther(f.sectionSelect, f.sectionOther));
  form._refreshSections = refreshSections;
  form._updatePreview = wireCitationPreview(f.citation, form.querySelector(".citation-preview"));

  f.reason.addEventListener("change", () => showReasonFields(form));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const r = state.reporting;
    const reason = f.reason.value;
    const fields = {
      resource_id: r.id,
      reason,
      details: f.details.value.trim(),
      note: f.note.value.trim(),
    };
    let problem = null;
    if (!reason) problem = "Please choose what the issue is.";
    if (reason === "move") {
      fields.type = f.type.value;
      fields.section = sectionValue(f.sectionSelect, f.sectionOther);
      if (!fields.section) problem = "Please choose or enter the correct section.";
      else if (fields.type === r.type && fields.section === r.section) problem = "That's where it already is.";
    }
    if (reason === "broken-link") {
      fields.url = f.url.value.trim();
      if (fields.url && !/^https?:\/\//i.test(fields.url)) problem = "Links must start with http:// or https://.";
    }
    if (reason === "citation") {
      fields.citation = f.citation.value.trim();
      if (!fields.citation) problem = "Please enter the corrected citation.";
    }
    if ((reason === "other" || reason === "remove") && !fields.details) problem = "Please add some details.";
    if (problem) return setStatus(form, problem, "error");
    send(form, "report", fields);
  });

  bindClose(els.reportDialog);
}

function openReport(r) {
  const form = els.reportForm;
  const f = form.elements;
  state.reporting = r;
  form.reset();
  els.reportEntryName.textContent = r.title;
  f.type.value = r.type;
  form._refreshSections(r.section);
  f.url.value = r.url || "";
  f.citation.value = r.citation;
  form._updatePreview();
  showReasonFields(form);
  openDialog(els.reportDialog, form);
}

function showReasonFields(form) {
  const reason = form.elements.reason.value;
  for (const block of form.querySelectorAll(".reason-fields")) {
    block.hidden = block.dataset.reason !== reason;
  }
  form.querySelector(".detail-req").hidden = !(reason === "other" || reason === "remove");
}

// ---------- shared form plumbing ----------

function bindClose(dialog) {
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
}

function openDialog(dialog, form) {
  setStatus(form, "");
  form.querySelector('[type="submit"]').disabled = false;
  dialog.showModal();
  mountTurnstile(form);
}

function mountTurnstile(form, attempt = 0) {
  if (state.widgets.has(form.id)) {
    window.turnstile.reset(state.widgets.get(form.id));
    return;
  }
  if (!state.siteKey || state.siteKey.startsWith("REPLACE")) {
    setStatus(form, "The form isn't set up yet. Please check back later.", "error");
    return;
  }
  if (!window.turnstile) {
    if (attempt < 50) setTimeout(() => mountTurnstile(form, attempt + 1), 100);
    else setStatus(form, "The verification check didn't load. Please refresh the page.", "error");
    return;
  }
  const id = window.turnstile.render(form.querySelector(".turnstile-slot"), { sitekey: state.siteKey });
  state.widgets.set(form.id, id);
}

async function send(form, kind, fields) {
  const widget = state.widgets.get(form.id);
  const token = widget !== undefined ? window.turnstile.getResponse(widget) : "";
  if (!token) return setStatus(form, "Please complete the verification check.", "error");

  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  setStatus(form, "Sending…");

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        fields,
        website: form.elements.website.value,
        turnstileToken: token,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "Something went wrong.");

    setStatus(form, "Thanks! Your submission was sent for review.", "success");
    form.dataset.done = "1";
    setTimeout(() => form.closest("dialog").close(), 1800);
  } catch (err) {
    setStatus(form, err.message, "error");
    submit.disabled = false;
  } finally {
    if (widget !== undefined) window.turnstile.reset(widget);
  }
}

function setStatus(form, message, kind = "") {
  const el = form.querySelector(".form-status");
  el.textContent = message;
  el.className = `form-status ${kind}`.trim();
}
