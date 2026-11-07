// Shared constants and validation used by both the public and admin APIs.

export const TYPES = [
  { id: "book", label: "Books" },
  { id: "childrens-book", label: "Children's & Picture Books" },
  { id: "website", label: "Websites & Organizations" },
  { id: "article", label: "Articles & Reports" },
  { id: "blog", label: "Blogs" },
  { id: "media", label: "Media (video, podcast, film)" },
];
const TYPE_IDS = new Set(TYPES.map((t) => t.id));

// Built-in sections offered in the forms for each type, even before any entry
// uses them. Sections that published entries use are added on top of these.
export const DEFAULT_SECTIONS = {
  book: [
    "Anti-racism, equity, identity & culturally responsive teaching",
    "Gender & sexuality",
    "Literacy & the Science of Reading",
    "ELL / multilingual learners",
    "Assessment, RTI & MTSS",
    "Instruction, planning & classroom community",
    "School law, restorative practice & special education",
    "Mathematics",
  ],
  "childrens-book": [
    "Identity, race & civil rights",
    "Immigration, refugees & global stories",
    "STEM identity & biography",
    "Disability & neurodiversity",
    "Native / Indigenous",
    "Poetry, music & read-aloud favorites",
    "Other genre exemplars",
  ],
  website: [
    "Anti-racism, equity & diverse books",
    "Native education & Since Time Immemorial",
    "Social studies & historical thinking",
    "Gender, sexuality & LGBTQ+ youth",
    "Disability",
    "ELL / multilingual learners",
    "Literacy & the Science of Reading",
    "Assessment, RTI & MTSS",
    "School law, safety & student wellbeing",
    "General tools",
  ],
  article: [
    "Anti-racism, equity & representation",
    "Gender & sexuality",
    "Literacy & the Science of Reading",
    "Assessment, RTI & MTSS",
    "ELL / multilingual",
    "Learning theory, group development & tech/law",
    "Mathematics",
    "Social studies methods",
  ],
  blog: [
    "Literacy & phonics",
    "Diverse-book lists",
    "ELL service models",
    "AI, digital citizenship & tech law",
    "School law",
    "Anti-racist practice",
  ],
  media: [
    "Anti-racism, gender & identity",
    "Disability",
    "Trauma-informed teaching",
    "Literacy & the Science of Reading",
    "Native education & Since Time Immemorial",
    "Mathematics",
  ],
};

export const REPORT_REASONS = {
  remove: "Should not be on this list",
  move: "Wrong type or section",
  "broken-link": "Broken or changed link",
  citation: "Citation needs a fix",
  other: "Other",
};

const LIMITS = {
  section: 120,
  title: 300,
  url: 500,
  description: 2000,
  citation: 1500,
  note: 1000,
};

export function clean(value, max) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

export function cleanNote(value) {
  return clean(value, LIMITS.note);
}

export function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validType(value) {
  return TYPE_IDS.has(value);
}

export function cleanSection(value) {
  return clean(value, LIMITS.section).replace(/\s+/g, " ");
}

export function cleanUrl(value) {
  const url = clean(value, LIMITS.url);
  if (!url) return { url: "" };
  if (!isHttpUrl(url)) return { error: "Links must start with http:// or https://." };
  return { url };
}

export function cleanCitation(value) {
  return clean(value, LIMITS.citation).replace(/\s+/g, " ");
}

// Validates a full resource (used for suggestions and admin edits).
export function validateResource(f = {}) {
  const type = String(f.type || "");
  if (!validType(type)) return { error: "Please choose a type." };

  const section = cleanSection(f.section);
  if (!section) return { error: "Please choose or enter a section." };

  const title = clean(f.title, LIMITS.title).replace(/\s+/g, " ");
  if (!title) return { error: "Please enter a title." };

  const link = cleanUrl(f.url);
  if (link.error) return { error: link.error };

  const description = clean(f.description, LIMITS.description);
  if (!description) return { error: "Please enter a short description." };

  const citation = cleanCitation(f.citation);
  if (!citation) return { error: "Please enter an APA 7 citation." };

  const approx = f.citation_approximate;
  return {
    value: {
      type,
      section,
      title,
      url: link.url || null,
      description,
      citation,
      citation_approximate: approx === true || approx === 1 || approx === "1" || approx === "on" ? 1 : 0,
    },
  };
}

export function slugify(text) {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "");
  return slug || "entry";
}

// Finds an unused id based on the title: "title", "title-2", "title-3", ...
export async function uniqueResourceId(db, title) {
  const base = slugify(title);
  const { results } = await db
    .prepare("SELECT id FROM resources WHERE id = ?1 OR id LIKE ?2")
    .bind(base, `${base}-%`)
    .all();
  const taken = new Set(results.map((r) => r.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function readJson(request, maxBytes = 20_000) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > maxBytes) return { error: json({ error: "Request is too large." }, 413) };
  const text = await request.text();
  if (text.length > maxBytes) return { error: json({ error: "Request is too large." }, 413) };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { error: json({ error: "Invalid request." }, 400) };
  }
}

export function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
