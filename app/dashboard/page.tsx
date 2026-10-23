"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ICP, FACTORS, PRESETS, scoreLead, tierOf, type FactorKey, type Icp, type Mode } from "@/lib/scoring";
import { draftEmail, type Tone } from "@/lib/outreach";
import { INDUSTRY_NAMES } from "@/lib/categories";

const STAGES = ["NEW", "CONTACTED", "REPLIED", "MEETING", "WON"] as const;
type Stage = (typeof STAGES)[number];
const STAGE_LABEL: Record<Stage, string> = { NEW: "New", CONTACTED: "Contacted", REPLIED: "Replied", MEETING: "Meeting", WON: "Won" };

type Lead = {
  id: string; name: string; industry: string; city: string | null; address: string | null;
  website: string | null; phone: string | null; email: string | null; signals: string[];
  foundedYear: number | null; score: number; enrichedAt: string | null; saved: boolean; stage: Stage;
};

const SIGNAL_LABEL: Record<string, string> = {
  hiring: "Hiring", family_owned: "Family-owned", no_booking: "No online booking", online_booking: "Online booking",
  no_mobile: "Not mobile friendly", no_https: "No HTTPS", social: "Social presence",
};
const KEY_SIGNALS = ["hiring", "family_owned", "no_booking"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.location.href = "/login";
    throw new Error(data.error || "Request failed");
  }
  return data as T;
}

export default function Dashboard() {
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [credits, setCredits] = useState(0);
  const [icp, setIcp] = useState<Icp>(DEFAULT_ICP);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [view, setView] = useState<"discover" | "pipeline">("discover");
  const [industry, setIndustry] = useState(INDUSTRY_NAMES[0]);
  const [place, setPlace] = useState("");
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "hot" | "warm">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>("friendly");
  const [toast, setToast] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2400); };
  const patch = (l: Lead) => setLeads((ls) => ls.map((x) => (x.id === l.id ? l : x)));

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ email: string; credits: number; icp: Icp }>("/api/me");
        setEmail(me.email); setCredits(me.credits); setIcp(me.icp);
        setLeads((await api<{ leads: Lead[] }>("/api/leads")).leads);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your data");
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const scored = useMemo(
    () => leads.map((l) => { const s = scoreLead(l, icp); return { ...l, total: s.total, parts: s.parts, tier: tierOf(s.total) }; }),
    [leads, icp],
  );
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scored
      .filter((l) => (!needle || `${l.name} ${l.city ?? ""} ${l.industry}`.toLowerCase().includes(needle)) && (tierFilter === "all" || (tierFilter === "hot" ? l.tier === "hot" : l.tier !== "cold")))
      .sort((a, b) => b.total - a.total);
  }, [scored, q, tierFilter]);
  const current = scored.find((l) => l.id === open) ?? null;
  const hotLeft = rows.filter((l) => l.tier === "hot" && !l.enrichedAt && l.website);

  useEffect(() => {
    if (!current) return;
    const d = draftEmail(current, icp.mode, tone);
    setSubject(d.subject); setBodyText(d.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tone, icp.mode]);

  async function findLeads() {
    setSearching(true); setError("");
    try {
      const r = await api<{ found: number; leads: Lead[] }>("/api/search", { method: "POST", body: JSON.stringify({ industry, place }) });
      setLeads((await api<{ leads: Lead[] }>("/api/leads")).leads);
      say(`Found ${r.found} businesses`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function importCsv(file: File) {
    setImporting(true); setError("");
    try {
      if (file.size > 5_000_000) throw new Error("File is too large (limit 5 MB)");
      const csv = await file.text();
      const r = await api<{ imported: number; updated: number; skipped: number }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ csv, defaultIndustry: industry }),
      });
      setLeads((await api<{ leads: Lead[] }>("/api/leads")).leads);
      say(`Imported ${r.imported} new, ${r.updated} updated, ${r.skipped} skipped`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function enrichOne(id: string): Promise<boolean> {
    setBusyId(id);
    try {
      const r = await api<{ lead: Lead; credits: number }>(`/api/leads/${id}/enrich`, { method: "POST" });
      patch(r.lead); setCredits(r.credits);
      return true;
    } catch (e) {
      say(e instanceof Error ? e.message : "Enrichment failed");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function batchEnrich() {
    setBatching(true);
    let n = 0;
    for (const l of hotLeft.slice(0, 10)) { if (await enrichOne(l.id)) n++; else break; }
    setBatching(false);
    if (n) say(`Enriched ${n} hot leads`);
  }

  async function update(id: string, data: { saved?: boolean; stage?: Stage }) {
    try { patch((await api<{ lead: Lead }>(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(data) })).lead); }
    catch (e) { say(e instanceof Error ? e.message : "Could not update"); }
  }

  async function saveIcp() {
    try { await api("/api/icp", { method: "PUT", body: JSON.stringify(icp) }); say("Profile saved"); }
    catch (e) { say(e instanceof Error ? e.message : "Could not save"); }
  }

  function copy(text: string, msg: string) {
    navigator.clipboard.writeText(text).then(() => say(msg), () => say("Copy failed, select the text and copy it"));
  }

  async function logout() { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }

  const setMode = (m: Mode) => setIcp({ ...icp, mode: m, weights: { ...PRESETS[m] } });
  const toggleIndustry = (n: string) => setIcp({ ...icp, industries: icp.industries.includes(n) ? icp.industries.filter((x) => x !== n) : [...icp.industries, n] });
  const setWeight = (k: FactorKey, v: number) => setIcp({ ...icp, weights: { ...icp.weights, [k]: v } });

  const saved = scored.filter((l) => l.saved);
  const hotCount = rows.filter((l) => l.tier === "hot").length;
  const skip = scored.filter((l) => l.tier === "cold" && !l.enrichedAt).length;

  if (booting) return <div className="empty">Loading your workspace</div>;

  return (
    <>
      <header className="top">
        <div className="brand">Lead Radar</div>
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={view === "discover"} onClick={() => setView("discover")}>Discover</button>
          <button className="tab" role="tab" aria-selected={view === "pipeline"} onClick={() => setView("pipeline")}>Pipeline ({saved.length})</button>
        </div>
        <div className="spacer" />
        <div className="credits"><span>Credits</span><div className="bar"><i style={{ width: `${Math.min(100, credits)}%` }} /></div><b className="num">{credits}</b></div>
        <a className="btn" href="/api/export">Export CSV</a>
        <button className="btn" onClick={logout} title={email}>Sign out</button>
      </header>

      <main className="wrap">
        {error && <p className="err" role="alert">{error}</p>}

        {view === "discover" && (
          <>
            <div className="strip">
              <div className="stat"><b>{rows.length}</b><span>Leads shown</span></div>
              <div className="stat hot"><b>{hotCount}</b><span>Hot fits</span></div>
              <div className="stat"><b>{scored.filter((l) => l.enrichedAt).length}</b><span>Enriched</span></div>
              <div className="stat"><b>{skip}</b><span>Credits you can skip</span></div>
            </div>
            <div className="grid">
              <aside className="panel rail">
                <div><h3>I am</h3>
                  <div className="seg">
                    <button aria-pressed={icp.mode === "buy"} onClick={() => setMode("buy")}>Buying a business</button>
                    <button aria-pressed={icp.mode === "sell"} onClick={() => setMode("sell")}>Selling to them</button>
                  </div></div>
                <div><h3>Industries</h3>
                  <div className="chips">{INDUSTRY_NAMES.map((n) => <button key={n} className="chip" aria-pressed={icp.industries.includes(n)} onClick={() => toggleIndustry(n)}>{n}</button>)}</div></div>
                <div><h3>What matters most</h3>
                  {FACTORS.map((f) => (
                    <div className="w" key={f.key}>
                      <label htmlFor={`w-${f.key}`} title={f.hint}>{f.label}</label>
                      <output>{icp.weights[f.key]}</output>
                      <input id={`w-${f.key}`} type="range" min={0} max={40} value={icp.weights[f.key]} onChange={(e) => setWeight(f.key, +e.target.value)} />
                    </div>
                  ))}</div>
                <button className="btn primary" onClick={saveIcp}>Save profile</button>
              </aside>

              <div className="panel">
                <div className="searchbar">
                  <select aria-label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)}>{INDUSTRY_NAMES.map((n) => <option key={n}>{n}</option>)}</select>
                  <input aria-label="City or area" placeholder="City or area, e.g. Austin, Texas" value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => e.key === "Enter" && place.trim().length > 1 && !searching && findLeads()} />
                  <button className="btn primary" disabled={searching || place.trim().length < 2} onClick={findLeads}>{searching ? "Searching" : "Find leads"}</button>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="Choose CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); }} />
                  <button className="btn" disabled={importing} onClick={() => fileRef.current?.click()} title="Columns: name (required), website, phone, email, industry, city, address, founded">{importing ? "Importing" : "Import CSV"}</button>
                </div>
                <div className="tools">
                  <input type="search" placeholder="Filter your leads" aria-label="Filter leads" value={q} onChange={(e) => setQ(e.target.value)} />
                  <select aria-label="Tier" value={tierFilter} onChange={(e) => setTierFilter(e.target.value as "all" | "hot" | "warm")}><option value="all">All tiers</option><option value="hot">Hot only</option><option value="warm">Warm and hot</option></select>
                  <button className="btn primary" disabled={batching || hotLeft.length === 0 || credits === 0} onClick={batchEnrich}>{batching ? "Enriching" : `Enrich ${Math.min(10, hotLeft.length)} hot leads`}</button>
                </div>
                <div className="tablewrap"><table>
                  <thead><tr><th>Score</th><th>Business</th><th>Contact</th><th>Signals</th><th></th></tr></thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.id} className={open === l.id ? "sel" : ""} onClick={() => setOpen(l.id)}>
                        <td><div className={`score ${l.tier}`}><span className="n">{l.total}</span><span className="t"><i style={{ width: `${l.total}%` }} /></span></div></td>
                        <td className="co"><b>{l.name}</b><span>{l.industry} · {l.city ?? "Unknown"}</span>{l.website && <div><a className="site" href={l.website} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{l.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a></div>}</td>
                        <td className="num">{l.phone ?? <span style={{ color: "var(--muted)" }}>No phone</span>}<br />{l.email ? l.email : <span className="locked">name@company.com</span>}</td>
                        <td>{l.enrichedAt ? l.signals.map((s) => <span key={s} className={`sig${KEY_SIGNALS.includes(s) ? " key" : ""}`}>{SIGNAL_LABEL[s] ?? s}</span>) : <span className="sig">Not enriched</span>}{l.foundedYear && <span className="sig">Since {l.foundedYear}</span>}</td>
                        <td><button className="btn sm" onClick={(e) => { e.stopPropagation(); update(l.id, { saved: !l.saved }); }}>{l.saved ? "In pipeline" : "Save"}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {rows.length === 0 && <div className="empty">{leads.length === 0 ? "No leads yet. Pick an industry, enter a city and press Find leads." : "No leads match these filters."}</div>}
                <div className="note">Businesses come from OpenStreetMap. Revenue and headcount are not available in public map data, so they are not scored. Enrichment reads the business's own website.</div>
              </div>
            </div>
          </>
        )}

        {view === "pipeline" && (
          <div className="board">
            {STAGES.map((s) => {
              const cards = saved.filter((l) => l.stage === s);
              return (
                <div className="col" key={s}>
                  <h3><span>{STAGE_LABEL[s]}</span><span className="num">{cards.length}</span></h3>
                  {cards.length === 0 && <div style={{ color: "var(--muted)", fontSize: 12.5 }}>Nothing here yet.</div>}
                  {cards.map((l) => (
                    <div className="card" key={l.id}>
                      <b>{l.name}</b>
                      <span style={{ color: "var(--muted)", fontSize: 12.5 }}>{l.city ?? ""} · {l.industry}</span>
                      <div className={`score ${l.tier}`}><span className="n">{l.total}</span><span className="t"><i style={{ width: `${l.total}%` }} /></span></div>
                      <div className="r">
                        <select aria-label={`Move ${l.name}`} value={l.stage} onChange={(e) => update(l.id, { stage: e.target.value as Stage })}>{STAGES.map((x) => <option key={x} value={x}>{STAGE_LABEL[x]}</option>)}</select>
                        <button className="btn sm" onClick={() => setOpen(l.id)}>Open</button>
                        <button className="btn sm" aria-label="Remove from pipeline" onClick={() => update(l.id, { saved: false })}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {current && (
        <>
          <div className="scrim" onClick={() => setOpen(null)} />
          <aside className="drawer" role="dialog" aria-label={current.name}>
            <div className="dh">
              <div><span className={`pill ${current.tier}`}>{current.tier.toUpperCase()} FIT</span><h2>{current.name}</h2><p>{current.industry} · {current.city ?? "Unknown"}{current.address ? ` · ${current.address}` : ""}</p></div>
              <button className="x" aria-label="Close" onClick={() => setOpen(null)}>✕</button>
            </div>
            <div className="big"><b className="num">{current.total}</b><span style={{ color: "var(--muted)" }}>of 100 against your profile</span></div>
            <div className="sec"><h4>Why this score</h4>
              {FACTORS.map((f) => { const v = Math.round(current.parts[f.key]); return (
                <div className="part" key={f.key}><span title={f.hint}>{f.label}</span><span className="t"><i style={{ width: `${v}%` }} /></span><em>{v} ×{icp.weights[f.key]}</em></div>
              ); })}
              {!current.enrichedAt && <p style={{ fontSize: 12, color: "var(--muted)", margin: "6px 0 0" }}>Partial score. Enrich this lead to read its website signals and refine the score.</p>}
            </div>
            <div className="sec"><h4>Contact</h4>
              <div className="contact">
                {current.website && <a className="site" href={current.website} target="_blank" rel="noopener noreferrer">{current.website}</a>}
                <div className="num">{current.phone ?? "No phone found"}</div>
                <div className="num">{current.email ?? (current.enrichedAt ? "No email found on the website" : "Email not looked up yet")}</div>
                {!current.enrichedAt && <div><button className="btn primary sm" disabled={busyId === current.id || credits < 1 || !current.website} onClick={() => enrichOne(current.id)}>{busyId === current.id ? "Reading website" : current.website ? "Enrich for 1 credit" : "No website to enrich"}</button></div>}
              </div>
            </div>
            <div className="sec mail"><h4>Outreach draft</h4>
              <div className="seg three">{(["friendly", "direct", "formal"] as Tone[]).map((t) => <button key={t} aria-pressed={tone === t} onClick={() => setTone(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
              <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              <textarea aria-label="Message" value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
              <div className="acts">
                <button className="btn primary" onClick={() => copy(`${subject}\n\n${bodyText}`, "Email copied")}>Copy email</button>
                <button className="btn" onClick={() => update(current.id, { saved: !current.saved })}>{current.saved ? `In pipeline: ${STAGE_LABEL[current.stage]}` : "Save to pipeline"}</button>
              </div>
            </div>
          </aside>
        </>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
