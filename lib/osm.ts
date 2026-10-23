import { INDUSTRIES } from "./categories";

export type DiscoveredBusiness = {
  osmId: string;
  name: string;
  industry: string;
  city: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  foundedYear: number | null;
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; data: DiscoveredBusiness[] }>();

function ua(): string {
  return `LeadRadar/1.0 (${process.env.CONTACT_EMAIL || "contact-not-set"})`;
}

export async function geocode(place: string): Promise<{ south: number; west: number; north: number; east: number; label: string }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place)}`;
  const res = await fetch(url, { headers: { "User-Agent": ua() }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const rows = (await res.json()) as Array<{ boundingbox: string[]; display_name: string }>;
  if (!rows.length) throw new Error(`Could not find the place "${place}"`);
  const [s, n, w, e] = rows[0].boundingbox.map(Number);
  return { south: s, north: n, west: w, east: e, label: rows[0].display_name };
}

export function buildQuery(industry: string, bbox: { south: number; west: number; north: number; east: number }, limit: number): string {
  const f = INDUSTRIES[industry];
  if (!f) throw new Error(`Unknown industry: ${industry}`);
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `[out:json][timeout:25];nwr["${f.key}"="${f.value}"]["name"](${box});out center tags ${limit};`;
}

type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function parseElements(elements: OsmElement[], industry: string, fallbackCity: string): DiscoveredBusiness[] {
  const out: DiscoveredBusiness[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    if (!t.name) continue;
    const website = t.website || t["contact:website"] || null;
    const phone = t.phone || t["contact:phone"] || null;
    const email = t.email || t["contact:email"] || null;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    const address = [street, t["addr:postcode"]].filter(Boolean).join(", ") || null;
    const yr = t.start_date ? parseInt(t.start_date.slice(0, 4), 10) : NaN;
    out.push({
      osmId: `${el.type}/${el.id}`,
      name: t.name.trim(),
      industry,
      city: t["addr:city"] || fallbackCity,
      address,
      lat: el.lat ?? el.center?.lat ?? null,
      lon: el.lon ?? el.center?.lon ?? null,
      website: website ? normalizeUrl(website) : null,
      phone,
      email: email ? email.split(";")[0].trim().toLowerCase() : null,
      foundedYear: Number.isFinite(yr) && yr > 1700 && yr <= new Date().getFullYear() ? yr : null,
    });
  }
  return out;
}

export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export async function discover(industry: string, place: string, limit = 80): Promise<DiscoveredBusiness[]> {
  const key = `${industry}|${place.toLowerCase().trim()}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const bbox = await geocode(place);
  const query = buildQuery(industry, bbox, limit);
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": ua(), "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Business search failed (${res.status}). Try a smaller area.`);
  const json = (await res.json()) as { elements: OsmElement[] };
  const data = parseElements(json.elements, industry, place.split(",")[0].trim());
  cache.set(key, { at: Date.now(), data });
  return data;
}
