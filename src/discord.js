// Posts a short notice to a Discord channel webhook for each new submission.
import { TYPES, REPORT_REASONS } from "./shared.js";

const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));

export async function notifyDiscord(env, sub, origin) {
  if (!env.DISCORD_WEBHOOK_URL) return;

  const p = sub.payload;
  const fields = [];
  let title;
  let color;

  if (sub.kind === "suggest") {
    title = `New suggestion: ${p.title}`;
    color = 0x1f6f5c;
    fields.push(
      { name: "Type", value: TYPE_LABEL[p.type] || p.type, inline: true },
      { name: "Section", value: p.section, inline: true },
    );
    if (p.url) fields.push({ name: "Link", value: p.url });
    fields.push({ name: "Citation", value: p.citation });
  } else {
    title = `Report: ${p.title}`;
    color = 0xb42318;
    fields.push(
      { name: "Reason", value: REPORT_REASONS[sub.reason] || sub.reason, inline: true },
      { name: "Entry ID", value: sub.resource_id, inline: true },
    );
    if (p.type) fields.push({ name: "Proposed type", value: TYPE_LABEL[p.type] || p.type, inline: true });
    if (p.section) fields.push({ name: "Proposed section", value: p.section, inline: true });
    if (p.url) fields.push({ name: "Proposed link", value: p.url });
    if (p.citation) fields.push({ name: "Proposed citation", value: p.citation });
    if (p.details) fields.push({ name: "Details", value: p.details });
  }

  const res = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "Teaching Resources",
      // Never let visitor text ping @everyone, roles, or users.
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: truncate(title, 250),
          url: `${origin}/admin/`,
          color,
          fields: fields.map((f) => ({ ...f, value: truncate(f.value || "-", 1000) })),
          footer: { text: `Submission #${sub.id} · review at /admin` },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  if (!res.ok) console.error("discord webhook", res.status, await res.text());
}

function truncate(text, max) {
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
