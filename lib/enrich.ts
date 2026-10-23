import * as cheerio from "cheerio";
import dns from "node:dns/promises";
import net from "node:net";

export type SiteFacts = {
  emails: string[];
  phones: string[];
  signals: string[];
  foundedYear: number | null;
};

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const JUNK_EMAIL = /(sentry|wixpress|example\.|domain\.com|your-?email|@2x|\.(png|jpe?g|gif|svg|webp)$)/i;

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}

// Blocks requests that would reach internal networks (SSRF).
export async function assertPublicUrl(raw: string): Promise<URL> {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https URLs are allowed");
  if (net.isIP(u.hostname)) {
    if (isPrivateIp(u.hostname)) throw new Error("Private addresses are not allowed");
    return u;
  }
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("Private addresses are not allowed");
  return u;
}

async function readLimited(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchHtml(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  let url = (await assertPublicUrl(rawUrl)).toString();
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const res = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": `LeadRadar/1.0 (${process.env.CONTACT_EMAIL || "contact-not-set"})`, Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = (await assertPublicUrl(new URL(res.headers.get("location")!, url).toString())).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Website returned ${res.status}`);
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) throw new Error("Website did not return a web page");
    return { html: await readLimited(res), finalUrl: url };
  }
  throw new Error("Too many redirects");
}

export function parseSite(html: string, finalUrl: string): SiteFacts {
  const $ = cheerio.load(html);
  const emails = new Set<string>();
  const phones = new Set<string>();

  $('a[href^="mailto:"]').each((_, el) => {
    const v = ($(el).attr("href") || "").replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
    if (v && !JUNK_EMAIL.test(v)) emails.add(v);
  });
  $('a[href^="tel:"]').each((_, el) => {
    const v = ($(el).attr("href") || "").replace(/^tel:/i, "").trim();
    if (v) phones.add(decodeURIComponent(v));
  });

  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  for (const m of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    const v = m[0].toLowerCase();
    if (!JUNK_EMAIL.test(v)) emails.add(v);
  }

  const lower = text.toLowerCase();
  const hrefs = $("a[href]").map((_, el) => ($(el).attr("href") || "").toLowerCase()).get().join(" ");
  const signals: string[] = [];

  if (/book (online|now|an appointment)|schedule (online|an appointment|now)|request (an )?appointment|online booking/.test(lower) || /calendly|acuity|booksy|simplybook|squareup\.com\/appointments/.test(hrefs)) signals.push("online_booking");
  else signals.push("no_booking");

  if (!$('meta[name="viewport"]').length) signals.push("no_mobile");
  if (!finalUrl.startsWith("https://")) signals.push("no_https");
  if (/(we'?re|now) hiring|join our team|careers|work with us|job openings/.test(lower) || /\/careers|\/jobs|indeed\.com/.test(hrefs)) signals.push("hiring");
  if (/family[- ](owned|operated|run)|locally owned|owner[- ]operated/.test(lower)) signals.push("family_owned");
  if (/facebook\.com|instagram\.com|linkedin\.com/.test(hrefs)) signals.push("social");

  let foundedYear: number | null = null;
  const m = lower.match(/(since|established|est\.?|founded( in)?|serving [a-z ]+ since)\s*(in\s*)?((19|20)\d{2})/);
  if (m) {
    const y = parseInt(m[4], 10);
    if (y >= 1850 && y <= new Date().getFullYear()) foundedYear = y;
  }

  return { emails: [...emails].slice(0, 5), phones: [...phones].slice(0, 3), signals, foundedYear };
}

export async function enrichWebsite(url: string): Promise<SiteFacts> {
  const { html, finalUrl } = await fetchHtml(url);
  return parseSite(html, finalUrl);
}
