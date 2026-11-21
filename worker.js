// SAVAS Art House: serves the static site and delivers contact-form inquiries
// by email through Cloudflare Email Routing (binding INQUIRY in wrangler.jsonc).
import { EmailMessage } from "cloudflare:email";

const FROM = "inquiries@savasarthouse.com";
const TO = "vs-bms@outlook.com";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const clean = (v, max) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);
const oneLine = (v, max) => clean(v, max).replace(/\n+/g, " ");
const b64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap = (s) => s.replace(/.{1,76}/g, "$&\r\n");

async function handleInquiry(request, env) {
  let d;
  try {
    d = await request.formData();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  // Honeypot: real visitors never fill this hidden field.
  if (clean(d.get("website"), 200)) return json({ ok: true });

  const name = oneLine(d.get("name"), 120);
  const email = oneLine(d.get("email"), 200);
  const topic = oneLine(d.get("topic"), 120) || "General inquiry";
  const artwork = oneLine(d.get("artwork"), 200);
  const message = clean(d.get("message"), 5000);

  if (!name || !/^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/.test(email)) {
    return json({ ok: false, error: "invalid" }, 400);
  }

  const subject = `SAVAS inquiry: ${topic}${artwork ? " / " + artwork : ""}`;
  const body =
    `New inquiry from savasarthouse.com\n\n` +
    `Name: ${name}\nEmail: ${email}\nTopic: ${topic}\nArtwork: ${artwork || "-"}\n\n` +
    `Message:\n${message || "-"}\n\n` +
    `Reply to this email to answer ${name} directly.\n`;

  const raw = [
    `From: ${encWord("SAVAS Art House website")} <${FROM}>`,
    `To: <${TO}>`,
    `Reply-To: ${encWord(name.replace(/[<>"]/g, ""))} <${email}>`,
    `Subject: ${encWord(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@savasarthouse.com>`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    wrap(b64(body.replace(/\n/g, "\r\n"))),
  ].join("\r\n");

  try {
    await env.INQUIRY.send(new EmailMessage(FROM, TO, raw));
    return json({ ok: true });
  } catch (err) {
    console.error("inquiry send failed", err && err.message);
    return json({ ok: false, error: "send_failed" }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/inquiry") {
      if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
      return handleInquiry(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
