"use strict";
// Helpers shared by the public site (app.js) and the admin page (admin.js).

const OTHER_SECTION = "__other__";

// Citations use *asterisks* for italics (APA italicizes titles).
function formatCitation(text) {
  return escapeHtml(text || "").replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function stripMarkup(text) {
  return (text || "").replace(/\*([^*]+)\*/g, "$1");
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function sectionsFor(resources, type) {
  return uniqueSorted(resources.filter((r) => !type || r.type === type).map((r) => r.section));
}

function fillTypeSelect(select, types, placeholder) {
  select.replaceChildren();
  if (placeholder) select.append(new Option(placeholder, ""));
  for (const t of types) select.append(new Option(t.label, t.id));
}

// A section dropdown with an "Other" choice that reveals a text box.
// `otherInput` is optional (the public filter bar doesn't have one).
function fillSectionSelect(select, sections, { placeholder, otherInput, current } = {}) {
  select.replaceChildren();
  if (placeholder) select.append(new Option(placeholder, ""));
  for (const s of sections) select.append(new Option(s, s));
  if (otherInput) select.append(new Option("Other (type a new one)", OTHER_SECTION));

  if (current && sections.includes(current)) {
    select.value = current;
  } else if (current && otherInput) {
    select.value = OTHER_SECTION;
    otherInput.value = current;
  } else {
    select.value = "";
  }
  if (otherInput) toggleOther(select, otherInput);
}

function toggleOther(select, otherInput) {
  const show = select.value === OTHER_SECTION;
  otherInput.closest("label").hidden = !show;
  otherInput.required = show;
}

function sectionValue(select, otherInput) {
  return select.value === OTHER_SECTION ? otherInput.value.trim() : select.value;
}

// Keeps a citation preview <p> in sync with a textarea.
function wireCitationPreview(textarea, preview) {
  const update = () => {
    preview.innerHTML = textarea.value.trim()
      ? formatCitation(textarea.value)
      : '<span class="muted">Preview appears here. Wrap titles in *asterisks* for italics.</span>';
  };
  textarea.addEventListener("input", update);
  update();
  return update;
}
