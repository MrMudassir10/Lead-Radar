import { createHash } from "node:crypto";
import { normalizeUrl } from "./osm";

export const MAX_ROWS = 5000;

export type ImportedRow = {
  key: string;
  name: string;
  industry: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  foundedYear: number | null;
};

export type ParseResult = {
  rows: ImportedRow[];
  skipped: number;
  columns: Record<string, string>; // field -> header found in the file
  error?: string;
};

// Reads CSV with quotes, escaped quotes, line breaks inside quotes, BOM, and , ; or tab separators.
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => firstLine.split(c).length - 1;
  const delim = count("\t") > count(";") && count("\t") > count(",") ? "\t" : count(";") > count(",") ? ";" : ",";

  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  return out;
}

const ALIASES: Record<string, string[]> = {
  name: ["name", "company", "companyname", "business", "businessname", "organization", "organisation", "account"],
  website: ["website", "url", "site", "domain", "web", "companywebsite", "websiteurl"],
  phone: ["phone", "phonenumber", "tel", "telephone", "mobile", "contactnumber"],
  email: ["email", "emailaddress", "mail", "contactemail"],
  industry: ["industry", "category", "type", "sector", "vertical"],
  city: ["city", "town", "location"],
  address: ["address", "street", "streetaddress"],
  founded: ["founded", "foundedyear", "yearfounded", "year", "since", "established"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function mapColumns(headers: string[]): Record<string, number> {
  const found: Record<string, number> = {};
  const normed = headers.map(norm);
  for (const [field, names] of Object.entries(ALIASES)) {
    const idx = normed.findIndex((h) => names.includes(h));
    if (idx >= 0) found[field] = idx;
  }
  return found;
}

const clean = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

export function rowKey(name: string, website: string | null, phone: string | null): string {
  let host = "";
  if (website) {
    try { host = new URL(website).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
  }
  const basis = `${name.toLowerCase().replace(/\s+/g, " ")}|${host || (phone ?? "").replace(/\D/g, "")}`;
  return "csv:" + createHash("sha1").update(basis).digest("hex").slice(0, 20);
}

export function parseLeads(csvText: string): ParseResult {
  const table = parseCsv(csvText);
  if (table.length < 2) return { rows: [], skipped: 0, columns: {}, error: "The file needs a header row and at least one lead." };

  const headers = table[0];
  const map = mapColumns(headers);
  if (map.name === undefined) {
    return { rows: [], skipped: 0, columns: {}, error: `No business name column found. Add a column called "name" or "company". Found: ${headers.slice(0, 8).join(", ")}` };
  }

  const columns: Record<string, string> = {};
  for (const [f, i] of Object.entries(map)) columns[f] = headers[i].trim();

  const seen = new Set<string>();
  const rows: ImportedRow[] = [];
  let skipped = 0;
  const year = new Date().getFullYear();

  for (const r of table.slice(1)) {
    if (rows.length >= MAX_ROWS) { skipped++; continue; }
    const get = (f: string) => (map[f] === undefined ? null : clean(r[map[f]]));
    const name = get("name");
    if (!name) { skipped++; continue; }

    const rawSite = get("website");
    const website = rawSite ? normalizeUrl(rawSite) : null;
    const phone = get("phone");
    const rawEmail = get("email");
    const email = rawEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail) ? rawEmail.toLowerCase() : null;
    const y = parseInt(get("founded") ?? "", 10);

    const key = rowKey(name, website, phone);
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);

    rows.push({
      key, name: name.slice(0, 200),
      industry: get("industry"), city: get("city"), address: get("address"),
      website, phone, email,
      foundedYear: Number.isFinite(y) && y >= 1700 && y <= year ? y : null,
    });
  }
  return { rows, skipped, columns };
}
