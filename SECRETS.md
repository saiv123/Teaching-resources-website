# Secrets and config: what goes where

This file lists secret **names** only, never values, so it is safe to commit.

## The rule

| Kind | Where it lives | In git? |
|---|---|---|
| **Secrets** (anything that grants access or lets someone act as you) | Cloudflare dashboard, or `npx wrangler secret put` | **Never** |
| **Public config** (IDs and keys designed to be visible) | `wrangler.jsonc` → `vars` | Yes |
| **Local dev values** | `.dev.vars` (copied from `.dev.vars.example`) | **Never** (gitignored) |

If a secret is ever committed, **rotate it immediately**. Deleting the file afterwards doesn't help: it stays in git history, and the repo is public.

## Secrets to set on Cloudflare

Set each one with `npx wrangler secret put NAME`, or in the dashboard under
**Workers & Pages → teaching-resources → Settings → Variables and Secrets** (type: *Secret*).

| Name | What it is | Where to get it | If it leaks |
|---|---|---|---|
| `TURNSTILE_SECRET` | Turnstile secret key; the Worker uses it to verify the human check | Dashboard → Turnstile → your widget | Someone could pass bot checks. Rotate the secret in the Turnstile settings |
| `DISCORD_WEBHOOK_URL` | URL that posts into your Discord channel | Discord → Channel settings → Integrations → Webhooks | Anyone can post into that channel. Delete the webhook and create a new one |
| `IP_HASH_SALT` | Random string mixed into IP hashes so the stored hashes can't be reversed back to IPs | Generate one (see below) | Low risk. Changing it only resets the rate limits |
| `ADMIN_API_TOKEN` | *Optional.* Lets a script or another Claude use `/api/admin/*` without Cloudflare Access | Generate one (see below) | **Full edit access to your list.** Replace it with a new value right away |

Generate a random value (PowerShell):

```powershell
-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

Only set `ADMIN_API_TOKEN` when you actually need it. Leaving it unset turns token access off entirely.

## Public config, committed in `wrangler.jsonc`

None of these grant access on their own:

| Name | Why it's safe to commit |
|---|---|
| `TURNSTILE_SITE_KEY` | Designed to be public; it's sent to every visitor's browser |
| `ACCESS_TEAM_DOMAIN` | Your Zero Trust login URL, visible to anyone who opens `/admin` |
| `ACCESS_AUD` | Identifies the Access application. Only useful together with a token signed by Cloudflare |
| D1 `database_id` | Just an identifier. Using it requires your Cloudflare login or API token |

Keep plain vars in `wrangler.jsonc`, not in the dashboard. Each deploy replaces dashboard *vars* with the ones in the file, but it leaves *secrets* alone.

## Local only, gitignored

| File / folder | What's in it |
|---|---|
| `.dev.vars` | Local copies of secrets for `npm run dev`. Use Turnstile's **test keys**, not your real ones |
| `.wrangler/` | Local D1 database and dev cache. It can contain test submissions |
| `node_modules/` | Installed packages |
| `backups/`, `*.sql` exports | D1 exports contain submissions (notes, IP hashes); keep them out of the public repo. `migrations/*.sql` is the exception and is committed |

Your Cloudflare login (`npx wrangler login`) is stored in your user profile, outside the repo, so it can't be committed by accident.

## Things that are *not* secrets but still shouldn't be public

- Submission data (reviewer notes, IP hashes) lives only in D1 and is visible only on `/admin`.
- `DEV_ADMIN_BYPASS=true` belongs only in `.dev.vars`. It only works on `localhost` anyway, but never set it on Cloudflare.

## Who can reach the admin side

- `/admin` and `/api/admin/*` are protected by **Cloudflare Access**, with only your email allowed.
- The Worker also checks the Access sign-in token itself, so a request that skips Access, for example through the `*.workers.dev` URL, gets **401 Not authorized**.
- Once your custom domain works, consider turning off the `workers.dev` URL (`"workers_dev": false` in `wrangler.jsonc`).
