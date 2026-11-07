// Admin authentication. A request is an admin if either:
//   1. Cloudflare Access let it through (we verify the signed JWT ourselves), or
//   2. it carries `Authorization: Bearer <ADMIN_API_TOKEN>` (for scripts or another Claude).
// If neither is configured, every admin request is refused.

let certCache = { url: "", keys: null, fetchedAt: 0 };

export async function requireAdmin(request, env) {
  if (env.DEV_ADMIN_BYPASS === "true" && isLocal(request)) return { who: "local-dev" };

  const auth = request.headers.get("Authorization") || "";
  if (env.ADMIN_API_TOKEN && auth.startsWith("Bearer ")) {
    if (await safeEqual(auth.slice(7), env.ADMIN_API_TOKEN)) return { who: "api-token" };
    return null;
  }

  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (jwt && env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    const claims = await verifyAccessJwt(jwt, env).catch(() => null);
    if (claims) return { who: claims.email || claims.sub || "access" };
  }
  return null;
}

function isLocal(request) {
  const host = new URL(request.url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function verifyAccessJwt(token, env) {
  const team = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, "");
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;

  const header = JSON.parse(b64urlText(h));
  const payload = JSON.parse(b64urlText(p));
  if (header.alg !== "RS256") return null;

  const keys = await getCerts(`${team}/cdn-cgi/access/certs`);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== team) return null;
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;
  return payload;
}

async function getCerts(url) {
  const fresh = Date.now() - certCache.fetchedAt < 60 * 60 * 1000;
  if (certCache.url === url && certCache.keys && fresh) return certCache.keys;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`certs ${res.status}`);
  const { keys } = await res.json();
  certCache = { url, keys, fetchedAt: Date.now() };
  return keys;
}

function b64urlBytes(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(str.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlText(str) {
  return new TextDecoder().decode(b64urlBytes(str));
}
