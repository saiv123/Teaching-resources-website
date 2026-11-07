// Cloudflare Worker entry point.
//   /api/config, /api/resources, /api/submit  -> public (src/public-api.js)
//   /api/admin/*                              -> admin only (src/admin-api.js)
//   everything else                           -> static files in ./public

import { getConfig, listResources, submit } from "./public-api.js";
import { handleAdmin } from "./admin-api.js";
import { requireAdmin } from "./auth.js";
import { json } from "./shared.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname === "/api/config" && method === "GET") return getConfig(env);
      if (pathname === "/api/resources" && method === "GET") return await listResources(env);
      if (pathname === "/api/submit" && method === "POST") return await submit(request, env, ctx);

      if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
        const admin = await requireAdmin(request, env);
        if (!admin) return json({ error: "Not authorized" }, 401);
        return await handleAdmin(request, env, url);
      }

      if (pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    } catch (err) {
      console.error("request failed", pathname, err);
      return json({ error: "Something went wrong. Please try again later." }, 500);
    }

    return env.ASSETS.fetch(request);
  },
};
