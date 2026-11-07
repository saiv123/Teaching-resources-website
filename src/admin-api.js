// Admin endpoints (all require requireAdmin). Used by /admin and by scripts.
//
//   GET    /api/admin/submissions?status=pending|approved|rejected
//   POST   /api/admin/submissions/:id/approve   { resource: {...}, action: "save" | "hide" }
//   POST   /api/admin/submissions/:id/reject
//   GET    /api/admin/resources                 (all, including hidden)
//   POST   /api/admin/resources                 { ...resource }          add directly
//   PUT    /api/admin/resources/:id             { ...resource, status }  edit / hide / unhide

import { validateResource, uniqueResourceId, json, readJson, sameOrigin } from "./shared.js";

export async function handleAdmin(request, env, url) {
  if (request.method !== "GET" && !sameOrigin(request)) return json({ error: "Forbidden" }, 403);

  const parts = url.pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
  const [collection, id, action] = parts;
  const method = request.method;

  if (collection === "submissions") {
    if (method === "GET" && !id) return listSubmissions(env, url.searchParams.get("status") || "pending");
    if (method === "POST" && id && action === "approve") return approve(request, env, id);
    if (method === "POST" && id && action === "reject") return reject(env, id);
  }

  if (collection === "resources") {
    if (method === "GET" && !id) return listAllResources(env);
    if (method === "POST" && !id) return createResource(request, env);
    if (method === "PUT" && id) return updateResource(request, env, id);
  }

  return json({ error: "Not found" }, 404);
}

async function listSubmissions(env, status) {
  if (!["pending", "approved", "rejected"].includes(status)) return json({ error: "Bad status" }, 400);
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.kind, s.resource_id, s.reason, s.payload, s.note, s.status,
            s.created_at, s.reviewed_at,
            r.type AS r_type, r.section AS r_section, r.title AS r_title, r.url AS r_url,
            r.description AS r_description, r.citation AS r_citation,
            r.citation_approximate AS r_citation_approximate, r.status AS r_status
       FROM submissions s
       LEFT JOIN resources r ON r.id = s.resource_id
      WHERE s.status = ?1
      ORDER BY s.created_at ${status === "pending" ? "ASC" : "DESC"}
      LIMIT 200`,
  ).bind(status).all();

  return json(
    results.map((row) => ({
      id: row.id,
      kind: row.kind,
      resource_id: row.resource_id,
      reason: row.reason,
      payload: safeParse(row.payload),
      note: row.note,
      status: row.status,
      created_at: row.created_at,
      reviewed_at: row.reviewed_at,
      current: row.r_title
        ? {
            type: row.r_type,
            section: row.r_section,
            title: row.r_title,
            url: row.r_url,
            description: row.r_description,
            citation: row.r_citation,
            citation_approximate: row.r_citation_approximate,
            status: row.r_status,
          }
        : null,
    })),
  );
}

async function approve(request, env, id) {
  const sub = await getPending(env, id);
  if (!sub) return json({ error: "Submission not found or already reviewed." }, 404);

  const { body, error } = await readJson(request);
  if (error) return error;
  const action = body.action === "hide" ? "hide" : "save";
  const markDone = env.DB.prepare(
    "UPDATE submissions SET status = 'approved', reviewed_at = datetime('now') WHERE id = ?1",
  ).bind(sub.id);

  if (sub.kind === "suggest") {
    const r = validateResource(body.resource);
    if (r.error) return json({ error: r.error }, 400);
    const newId = await uniqueResourceId(env.DB, r.value.title);
    await env.DB.batch([insertResource(env, newId, r.value), markDone]);
    return json({ ok: true, resource_id: newId });
  }

  // Report: either hide the entry, or save the edited version.
  const exists = await env.DB.prepare("SELECT id FROM resources WHERE id = ?1").bind(sub.resource_id).first();
  if (!exists) return json({ error: "The reported entry no longer exists. Reject this report instead." }, 409);

  if (action === "hide") {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE resources SET status = 'hidden', updated_at = datetime('now') WHERE id = ?1",
      ).bind(sub.resource_id),
      markDone,
    ]);
    return json({ ok: true, resource_id: sub.resource_id });
  }

  const r = validateResource(body.resource);
  if (r.error) return json({ error: r.error }, 400);
  await env.DB.batch([updateStatement(env, sub.resource_id, r.value, "published"), markDone]);
  return json({ ok: true, resource_id: sub.resource_id });
}

async function reject(env, id) {
  const sub = await getPending(env, id);
  if (!sub) return json({ error: "Submission not found or already reviewed." }, 404);
  await env.DB.prepare(
    "UPDATE submissions SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ?1",
  ).bind(sub.id).run();
  return json({ ok: true });
}

async function listAllResources(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, type, section, title, url, description, citation, citation_approximate,
            status, created_at, updated_at
       FROM resources ORDER BY type, section, title`,
  ).all();
  return json(results);
}

async function createResource(request, env) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const r = validateResource(body);
  if (r.error) return json({ error: r.error }, 400);
  const newId = await uniqueResourceId(env.DB, r.value.title);
  await insertResource(env, newId, r.value).run();
  return json({ ok: true, resource_id: newId }, 201);
}

async function updateResource(request, env, id) {
  const { body, error } = await readJson(request);
  if (error) return error;
  const exists = await env.DB.prepare("SELECT id FROM resources WHERE id = ?1").bind(id).first();
  if (!exists) return json({ error: "Not found" }, 404);
  const r = validateResource(body);
  if (r.error) return json({ error: r.error }, 400);
  const status = body.status === "hidden" ? "hidden" : "published";
  await updateStatement(env, id, r.value, status).run();
  return json({ ok: true, resource_id: id });
}

// ---------- helpers ----------

async function getPending(env, id) {
  if (!/^\d+$/.test(id)) return null;
  return env.DB.prepare("SELECT * FROM submissions WHERE id = ?1 AND status = 'pending'")
    .bind(Number(id))
    .first();
}

function insertResource(env, id, v) {
  return env.DB.prepare(
    `INSERT INTO resources (id, type, section, title, url, description, citation, citation_approximate)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(id, v.type, v.section, v.title, v.url, v.description, v.citation, v.citation_approximate);
}

function updateStatement(env, id, v, status) {
  return env.DB.prepare(
    `UPDATE resources
        SET type = ?2, section = ?3, title = ?4, url = ?5, description = ?6,
            citation = ?7, citation_approximate = ?8, status = ?9, updated_at = datetime('now')
      WHERE id = ?1`,
  ).bind(id, v.type, v.section, v.title, v.url, v.description, v.citation, v.citation_approximate, status);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
