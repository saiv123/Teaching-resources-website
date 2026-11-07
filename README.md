# Teaching Resources

A searchable list of free books, websites, videos, and online resources for teachers, each with an APA 7 citation.

- **Public site:** search and filter by type and section. Anyone can suggest a resource or report an entry, no account needed.
- **Review queue (`/admin`):** nothing goes live until it's approved. New submissions ping a Discord channel.
- **Stack:** one Cloudflare Worker (static files + API), Cloudflare D1 (database), Turnstile (bot check), Cloudflare Access (admin login).

See [SECRETS.md](SECRETS.md) for what is secret, what is committed, and what gets set on Cloudflare.

## Project layout

```
public/            static site (index.html, admin/, css/, js/)
src/worker.js      routes requests
src/public-api.js  /api/config, /api/resources, /api/submit
src/admin-api.js   /api/admin/* (review queue, edit entries)
src/auth.js        Cloudflare Access + optional API-token check
src/discord.js     Discord webhook notifications
src/shared.js      types, validation, helpers
migrations/        D1 schema
```

## Local development

```powershell
npm install
copy .dev.vars.example .dev.vars        # test keys only; never commit .dev.vars
npm run db:migrate:local
npm run dev                             # http://localhost:8787  and  /admin/
```

Locally, `/admin` works without signing in (`DEV_ADMIN_BYPASS`, localhost only).

## First-time Cloudflare setup

1. **Database**
   ```powershell
   npx wrangler login
   npx wrangler d1 create teaching-resources
   ```
   Put the printed `database_id` in `wrangler.jsonc`, then run `npm run db:migrate:remote`.

2. **Turnstile:** Dashboard → Turnstile → Add widget, with your site's hostname. Put the **site key** in `wrangler.jsonc` (`TURNSTILE_SITE_KEY`), then set the secret:
   ```powershell
   npx wrangler secret put TURNSTILE_SECRET
   ```

3. **Discord:** Channel settings → Integrations → Webhooks → New webhook → copy the URL.
   ```powershell
   npx wrangler secret put DISCORD_WEBHOOK_URL
   npx wrangler secret put IP_HASH_SALT        # any random string
   ```

4. **Deploy:** `npm run deploy`, or connect the repo in the dashboard (Workers & Pages → Create → Import a repository) so every push to `main` deploys. Then add your custom domain under the Worker's **Settings → Domains & Routes**.

5. **Lock down `/admin` with Cloudflare Access** (Zero Trust → Access → Applications → Add → Self-hosted):
   - Domain: your site, paths `admin` and `api/admin`
   - Policy: Allow → Emails → your email
   - Copy the **Application Audience (AUD) tag** into `ACCESS_AUD`, and your team domain (`https://<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`, then deploy again.

   Until both are set, every admin request is refused (fails closed).

## Adding entries

- **Normally:** approve suggestions in `/admin`, or use **All entries → Add entry**.
- **From a script or another tool:** set `ADMIN_API_TOKEN` (see SECRETS.md) and call the admin API:
  ```
  POST /api/admin/resources
  Authorization: Bearer <ADMIN_API_TOKEN>
  { "type": "book", "section": "...", "title": "...", "url": "", "description": "...",
    "citation": "Author, A. (Year). *Title*. Publisher.", "citation_approximate": false }
  ```
  Types: `book`, `childrens-book`, `website`, `article`, `blog`, `media`. Wrap titles in `*asterisks*` to italicize them in citations.

## Licenses

- Code: [MIT](LICENSE)
- Resource entries and annotations: [CC BY 4.0](LICENSE-CONTENT)
