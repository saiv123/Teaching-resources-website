// Public endpoints: list published resources and accept suggestions/reports.
import {
  TYPES,
  REPORT_REASONS,
  validateResource,
  validType,
  cleanSection,
  cleanUrl,
  cleanCitation,
  cleanNote,
  clean,
  json,
  readJson,
  sameOrigin,
} from "./shared.js";
import { notifyDiscord } from "./discord.js";

const RATE_LIMIT_PER_HOUR = 10;

export function getConfig(env) {
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || "", types: TYPES });
}

export async function listResources(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, type, section, title, url, description, citation, citation_approximate
       FROM resources
      WHERE status = 'published'
      ORDER BY section, title`,
  ).all();
  return json(results, 200, { "Cache-Control": "public, max-age=60" });
}

export async function submit(request, env, ctx) {
  if (!sameOrigin(request)) return json({ error: "Forbidden" }, 403);
  if (!env.TURNSTILE_SECRET) return json({ error: "Submissions are not configured yet." }, 503);

  const { body, error } = await readJson(request);
  if (error) return error;

  // Honeypot: real people never fill this hidden field. Pretend it worked.
  if (body.website) return json({ ok: true });

  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (!(await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip))) {
    return json({ error: "Verification failed. Please try the check again." }, 400);
  }

  const ipHash = await hashIp(ip, env.IP_HASH_SALT || "");
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM submissions
      WHERE ip_hash = ?1 AND created_at > datetime('now', '-1 hour')`,
  ).bind(ipHash).first();
  if (recent && recent.n >= RATE_LIMIT_PER_HOUR) {
    return json({ error: "Too many submissions. Please try again later." }, 429);
  }

  const fields = body.fields || {};
  const note = cleanNote(fields.note);
  let row;

  if (body.kind === "suggest") {
    const r = validateResource(fields);
    if (r.error) return json({ error: r.error }, 400);
    row = { kind: "suggest", resource_id: null, reason: null, payload: r.value, note };
  } else if (body.kind === "report") {
    const r = await validateReport(env, fields);
    if (r.error) return json({ error: r.error }, 400);
    row = { kind: "report", ...r.value, note };
  } else {
    return json({ error: "Unknown submission type." }, 400);
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO submissions (kind, resource_id, reason, payload, note, ip_hash)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     RETURNING id`,
  )
    .bind(row.kind, row.resource_id, row.reason, JSON.stringify(row.payload), row.note || null, ipHash)
    .first();

  ctx.waitUntil(
    notifyDiscord(env, { ...row, id: inserted.id }, new URL(request.url).origin).catch((err) =>
      console.error("discord notify failed", err),
    ),
  );

  return json({ ok: true });
}

async function validateReport(env, f) {
  const resourceId = String(f.resource_id || "");
  if (!/^[a-z0-9-]{1,80}$/.test(resourceId)) return { error: "Unknown entry." };
  const resource = await env.DB.prepare(
    "SELECT id, title FROM resources WHERE id = ?1 AND status = 'published'",
  ).bind(resourceId).first();
  if (!resource) return { error: "That entry no longer exists." };

  const reason = Object.hasOwn(REPORT_REASONS, f.reason) ? f.reason : null;
  if (!reason) return { error: "Please choose what the issue is." };

  const payload = { title: resource.title };
  if (reason === "move") {
    if (!validType(f.type)) return { error: "Please choose the correct type." };
    const section = cleanSection(f.section);
    if (!section) return { error: "Please choose or enter the correct section." };
    payload.type = f.type;
    payload.section = section;
  } else if (reason === "broken-link") {
    const link = cleanUrl(f.url);
    if (link.error) return { error: link.error };
    if (link.url) payload.url = link.url;
  } else if (reason === "citation") {
    const citation = cleanCitation(f.citation);
    if (!citation) return { error: "Please enter the corrected citation." };
    payload.citation = citation;
  }

  const details = clean(f.details, 2000);
  if (details) payload.details = details;
  if ((reason === "other" || reason === "remove") && !details) {
    return { error: "Please add some details." };
  }

  return { value: { resource_id: resourceId, reason, payload } };
}

async function verifyTurnstile(token, secret, ip) {
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.success === true;
}

async function hashIp(ip, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
