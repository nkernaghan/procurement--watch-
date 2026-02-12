// pages/index.js
import { useState, useEffect, useCallback, useRef } from "react";
import { SOURCES, BATCHES, REGIONS, CATS } from "../lib/sources";

const CKEY = "procwatch-v8";
const DAY = 86400000;
const MIN_COOLDOWN = 5 * 60 * 1000;
const BATCH_DELAY = 5000;
const RC = { EU: "#60a5fa", UK: "#a78bfa", US: "#fbbf24", Nordics: "#34d399", Baltics: "#f472b6" };
const CC = { crypto: "#4ade80", insider_threat: "#c084fc" };

function stableKey(src, it) {
  return `${src}|${(it.notice_id || it.url || it.title || "").toString().replace(/[\s"'/\\]/g, "_").slice(0, 140)}`;
}

function parseResponse(text) {
  const clean = text.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  const s = clean.indexOf("{");
  const e = clean.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try { return JSON.parse(clean.slice(s, e + 1)); } catch {}
  }
  if (s >= 0) {
    let attempt = clean.slice(s);
    let braces = 0, brackets = 0;
    for (const ch of attempt) {
      if (ch === "{") braces++;
      if (ch === "}") braces--;
      if (ch === "[") brackets++;
      if (ch === "]") brackets--;
    }
    attempt += "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, braces));
    try { return JSON.parse(attempt); } catch {}
  }
  return null;
}

function loadDB() {
  if (typeof window === "undefined") return { items: [], idx: {}, runs: [], scanned: {}, lastRunAt: null, rateLimitUntil: null };
  try {
    const raw = localStorage.getItem(CKEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { items: [], idx: {}, runs: [], scanned: {}, lastRunAt: null, rateLimitUntil: null };
}

function saveDB(db) {
  try { localStorage.setItem(CKEY, JSON.stringify(db)); return true; }
  catch { return false; }
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
function fmtTime(d) { return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function fmtCountdown(ms) {
  if (ms <= 0) return "";
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function callBatch(batch, signal) {
  // Calls YOUR server at /api/pull — key stays server-side
  const response = await fetch("/api/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: "You search the web for government procurement notices on the specific official portals listed. Return ONLY a valid JSON object with the exact keys requested. No markdown fences, no commentary.",
      messages: [{ role: "user", content: batch.prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  return response;
}

export default function Dashboard() {
  const [db, setDb] = useState({ items: [], idx: {}, runs: [], scanned: {}, lastRunAt: null, rateLimitUntil: null });
  const [sts, setSts] = useState({});
  const [flt, setFlt] = useState({ q: "", region: "All", cat: "All", newOnly: false });
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("notices");
  const [banner, setBanner] = useState(null);
  const [batchProgress, setBatchProgress] = useState("");
  const [tick, setTick] = useState(0);
  const ac = useRef(null);

  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);

  useEffect(() => {
    const d = loadDB();
    setDb(d);
    if (d.rateLimitUntil && new Date(d.rateLimitUntil).getTime() > Date.now()) {
      setBanner({ type: "rate", msg: `Rate limited. Retry after ${fmtTime(d.rateLimitUntil)}.`, until: d.rateLimitUntil });
    }
    setReady(true);
  }, []);

  const now = Date.now();
  const rlUntil = banner?.type === "rate" && banner.until ? new Date(banner.until).getTime() : 0;
  const cdUntil = db.lastRunAt ? new Date(db.lastRunAt).getTime() + MIN_COOLDOWN : 0;
  const blockedUntil = Math.max(rlUntil, cdUntil);
  const isBlocked = blockedUntil > now;
  const blockedStr = isBlocked ? fmtCountdown(blockedUntil - now) : "";

  const tagged = db.items.map((n) => {
    const s = SOURCES.find((x) => x.id === n._src);
    const ix = db.idx[n._key] || {};
    return { ...n, _region: s?.region || "", _cat: s?.cat || "", _label: s?.label || n._src || "", _new: !ix.first || now - new Date(ix.first).getTime() < DAY };
  });
  const newCt = tagged.filter((n) => n._new).length;

  const run = useCallback(async () => {
    if (busy || isBlocked) return;
    setBusy(true);
    setBanner(null);
    setBatchProgress("");
    ac.current = new AbortController();

    const initSts = {};
    SOURCES.forEach((s) => { initSts[s.id] = { st: "wait", pull: 0, add: 0, err: "" }; });
    setSts(initSts);

    const ts = new Date().toISOString();
    const up = { items: [...db.items], idx: { ...db.idx }, runs: [...(db.runs || [])], scanned: { ...(db.scanned || {}) }, lastRunAt: ts, rateLimitUntil: null };
    const allStats = [];
    let aborted = false;

    for (let bi = 0; bi < BATCHES.length; bi++) {
      if (ac.current.signal.aborted) { aborted = true; break; }
      const batch = BATCHES[bi];
      setBatchProgress(`Batch ${bi + 1}/${BATCHES.length}: ${batch.label}…`);
      batch.sourceIds.forEach((sid) => { setSts((p) => ({ ...p, [sid]: { st: "load", pull: 0, add: 0, err: "" } })); });

      if (bi > 0) {
        setBatchProgress(`Waiting ${BATCH_DELAY / 1000}s before batch ${bi + 1}/${BATCHES.length}: ${batch.label}…`);
        await delay(BATCH_DELAY);
        if (ac.current.signal.aborted) { aborted = true; break; }
        setBatchProgress(`Batch ${bi + 1}/${BATCHES.length}: ${batch.label}…`);
      }

      let response;
      try {
        response = await callBatch(batch, ac.current.signal);
      } catch (e) {
        if (e.name === "AbortError") { aborted = true; break; }
        batch.sourceIds.forEach((sid) => { setSts((p) => ({ ...p, [sid]: { st: "err", pull: 0, add: 0, err: "Network error" } })); allStats.push({ id: sid, st: "err", pull: 0, add: 0 }); });
        continue;
      }

      if (response.status === 429) {
        let retryAt;
        try { const body = await response.json(); const epoch = body?.error?.resetsAt || body?.error?.metadata?.resetsAt; if (epoch) retryAt = new Date(epoch * 1000); } catch {}
        if (!retryAt) retryAt = new Date(now + 120000);
        setBanner({ type: "rate", msg: `Rate limited on batch ${bi + 1}. Retry after ${fmtTime(retryAt)}.`, until: retryAt.toISOString() });
        up.rateLimitUntil = retryAt.toISOString();
        batch.sourceIds.forEach((sid) => { setSts((p) => ({ ...p, [sid]: { st: "err", pull: 0, add: 0, err: "429" } })); allStats.push({ id: sid, st: "err", pull: 0, add: 0 }); });
        for (let rbi = bi + 1; rbi < BATCHES.length; rbi++) {
          BATCHES[rbi].sourceIds.forEach((sid) => { setSts((p) => ({ ...p, [sid]: { st: "err", pull: 0, add: 0, err: "Aborted (429)" } })); allStats.push({ id: sid, st: "err", pull: 0, add: 0 }); });
        }
        aborted = true; break;
      }

      if (!response.ok) {
        batch.sourceIds.forEach((sid) => { setSts((p) => ({ ...p, [sid]: { st: "err", pull: 0, add: 0, err: `HTTP ${response.status}` } })); allStats.push({ id: sid, st: "err", pull: 0, add: 0 }); });
        continue;
      }

      let data;
      try { data = await response.json(); } catch {
        batch.sourceIds.forEach((sid) => { setSts((p) => ({ ...p, [sid]: { st: "err", pull: 0, add: 0, err: "JSON parse fail" } })); allStats.push({ id: sid, st: "err", pull: 0, add: 0 }); });
        continue;
      }

      const fullText = (data.content || []).map((b) => b.type === "text" ? b.text : "").filter(Boolean).join("\n");
      const results = parseResponse(fullText);

      if (!results) {
        batch.sourceIds.forEach((sid) => { setSts((p) => ({ ...p, [sid]: { st: "err", pull: 0, add: 0, err: "No valid JSON" } })); allStats.push({ id: sid, st: "err", pull: 0, add: 0 }); });
        continue;
      }

      for (const sid of batch.sourceIds) {
        const arr = results[sid];
        const valid = Array.isArray(arr) ? arr.filter((x) => x && (x.title || x.url)) : [];
        let added = 0;
        for (const it of valid) {
          const k = stableKey(sid, it);
          if (up.idx[k]) { up.idx[k].last = ts; }
          else { up.idx[k] = { first: ts, last: ts }; up.items.push({ ...it, _key: k, _src: sid }); added++; }
        }
        up.scanned[sid] = ts;
        setSts((p) => ({ ...p, [sid]: { st: "ok", pull: valid.length, add: added, err: "" } }));
        allStats.push({ id: sid, st: "ok", pull: valid.length, add: added });
      }
      setDb({ ...up });
    }

    const totalNew = allStats.reduce((a, x) => a + (x.add || 0), 0);
    const totalOk = allStats.filter((x) => x.st === "ok").length;
    const totalErr = allStats.filter((x) => x.st === "err").length;
    up.runs = [{ t: ts, stats: allStats, tot: totalNew, ok: totalOk, err: totalErr }, ...up.runs.slice(0, 29)];
    setDb({ ...up });
    saveDB(up);
    setBatchProgress("");
    if (!aborted) {
      setBanner({ type: totalErr > 0 ? "error" : "ok", msg: totalNew > 0 ? `Done. ${totalNew} new tenders. (${totalOk} OK, ${totalErr} errors)` : `Done. No new tenders. (${totalOk} OK, ${totalErr} errors)` });
    }
    setBusy(false);
  }, [busy, db, isBlocked, now]);

  const stop = () => { ac.current?.abort(); setBusy(false); setBatchProgress(""); };
  const clear = () => { const e = { items: [], idx: {}, runs: [], scanned: {}, lastRunAt: null, rateLimitUntil: null }; setDb(e); setSts({}); setBanner(null); saveDB(e); };

  const rows = tagged.filter((r) => {
    const b = [r.title, r.buyer, r.country, r.notice_id, r.url, r._label].join(" ").toLowerCase();
    if (flt.q && !b.includes(flt.q.toLowerCase())) return false;
    if (flt.region !== "All" && r._region !== flt.region) return false;
    if (flt.cat !== "All" && r._cat !== flt.cat) return false;
    if (flt.newOnly && !r._new) return false;
    return true;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const cOk = Object.values(sts).filter((s) => s.st === "ok").length;
  const cErr = Object.values(sts).filter((s) => s.st === "err").length;
  const cLoad = Object.values(sts).filter((s) => s.st === "load").length;
  const cWait = Object.values(sts).filter((s) => s.st === "wait").length;

  if (!ready) return <div style={S.loading}>Loading…</div>;

  return (
    <div style={S.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=IBM+Plex+Sans:wght@400;600;700&display=swap');
        @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes glow{0%,100%{box-shadow:0 0 4px #22c55e11}50%{box-shadow:0 0 14px #22c55e33}}
        *{box-sizing:border-box}.rw:hover{background:#0d1117!important}
        body{margin:0;background:#080b10}
      `}</style>

      {/* HEADER */}
      <div style={S.hdr}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={S.title}><span style={{ color: "#22c55e" }}>◆</span> PROCUREMENT WATCH</div>
            <div style={S.sub}>{db.items.length} cached · {newCt} new · {BATCHES.length} batches/run · {db.runs.length > 0 ? "Last: " + new Date(db.runs[0].t).toLocaleString() : "Never run"}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button onClick={clear} style={S.ghost}>Clear</button>
            {busy ? (
              <button onClick={stop} style={S.stopBtn}>■ Stop</button>
            ) : (
              <button onClick={run} disabled={isBlocked} style={{ ...S.goBtn, opacity: isBlocked ? 0.35 : 1, cursor: isBlocked ? "not-allowed" : "pointer", animation: !isBlocked && db.items.length === 0 ? "glow 2.5s infinite" : "none" }}>
                {isBlocked ? `⏳ ${blockedStr}` : "▶ Pull contracts"}
              </button>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
          {[["notices", `Notices (${db.items.length})`], ["health", "Health"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...S.tab, ...(tab === k ? S.tabOn : {}) }}>{l}</button>
          ))}
        </div>
      </div>

      {banner && (
        <div style={{ padding: "10px 20px", borderBottom: "1px solid", borderColor: banner.type === "rate" ? "#854d0e" : banner.type === "error" ? "#7f1d1d" : "#14532d", background: banner.type === "rate" ? "#1a1000" : banner.type === "error" ? "#1c0a0a" : "#071209", color: banner.type === "rate" ? "#fbbf24" : banner.type === "error" ? "#fca5a5" : "#4ade80", fontSize: 11, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          {banner.type === "rate" ? "⚠" : banner.type === "error" ? "✗" : "✓"} <span>{banner.msg}</span>
          {banner.type === "rate" && rlUntil > now && <span style={{ color: "#eab308", fontWeight: 600 }}>({fmtCountdown(rlUntil - now)})</span>}
          {banner.type === "rate" && rlUntil <= now && <button onClick={() => { setBanner(null); run(); }} style={{ ...S.ghost, color: "#4ade80", borderColor: "#14532d" }}>▶ Retry</button>}
          <button onClick={() => setBanner(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#4b5563", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {batchProgress && (
        <div style={{ padding: "6px 20px", background: "#0c1117", borderBottom: "1px solid #151b24", color: "#eab308", fontSize: 11, animation: "pulse 1.5s infinite" }}>⟳ {batchProgress}</div>
      )}

      {Object.keys(sts).length > 0 && (
        <div style={S.statusBar}>
          {cOk > 0 && <span style={{ color: "#4ade80" }}>✓{cOk}</span>}
          {cErr > 0 && <span style={{ color: "#f87171" }}>✗{cErr}</span>}
          {cLoad > 0 && <span style={{ color: "#eab308" }}>⟳{cLoad}</span>}
          {cWait > 0 && <span style={{ color: "#4b5563" }}>◦{cWait}</span>}
          <span style={{ color: "#374151" }}>{tagged.length} total</span>
          <div style={{ display: "flex", gap: 3, marginLeft: 6 }}>
            {SOURCES.map((s) => { const x = sts[s.id]; const bg = !x ? "#151b24" : x.st === "ok" ? (x.pull > 0 ? "#22c55e" : "#6b7280") : x.st === "err" ? "#ef4444" : x.st === "load" ? "#eab308" : "#252830"; return <div key={s.id} title={`${s.label}: ${x?.st || "—"} · ${x?.pull || 0} pulled · ${x?.add || 0} new`} style={{ width: 9, height: 9, borderRadius: 2, background: bg, animation: x?.st === "load" ? "pulse .7s infinite" : "none", cursor: "help" }} />; })}
          </div>
        </div>
      )}

      <div style={{ padding: "0 20px 40px" }}>
        {tab === "notices" && (<>
          <div style={S.fRow}>
            <input value={flt.q} onChange={(e) => setFlt((f) => ({ ...f, q: e.target.value }))} placeholder="Search…" style={{ ...S.inp, width: 200 }} />
            <select value={flt.region} onChange={(e) => setFlt((f) => ({ ...f, region: e.target.value }))} style={S.inp}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select>
            <select value={flt.cat} onChange={(e) => setFlt((f) => ({ ...f, cat: e.target.value }))} style={S.inp}>{CATS.map((c) => <option key={c} value={c}>{c === "All" ? "All" : c === "crypto" ? "Crypto" : "Insider"}</option>)}</select>
            <label style={{ fontSize: 10, color: flt.newOnly ? "#4ade80" : "#4b5563", cursor: "pointer", display: "flex", gap: 3, alignItems: "center" }}><input type="checkbox" checked={flt.newOnly} onChange={(e) => setFlt((f) => ({ ...f, newOnly: e.target.checked }))} style={{ accentColor: "#22c55e" }} /> New</label>
            <button onClick={() => setFlt({ q: "", region: "All", cat: "All", newOnly: false })} style={S.ghost}>Reset</button>
            <span style={{ fontSize: 10, color: "#374151" }}>{rows.length}/{tagged.length}</span>
          </div>

          {db.items.length === 0 && !busy && (
            <div style={S.empty}>
              <div style={{ fontSize: 44, marginBottom: 14, opacity: .15 }}>◆</div>
              <div style={{ fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif" }}>No tenders cached yet</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Hit <span style={{ color: "#4ade80", fontWeight: 600 }}>▶ Pull contracts</span> — {BATCHES.length} batches, {SOURCES.length} sources</div>
            </div>
          )}

          {busy && db.items.length === 0 && (
            <div style={{ textAlign: "center", padding: "50px 20px", color: "#4b5563", animation: "pulse 1.5s infinite", fontSize: 12 }}>{batchProgress || "Starting…"}</div>
          )}

          {rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={S.tbl}>
                <thead><tr>{["", "Date", "Region", "Cat", "Title", "Buyer", "Source"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={r._key || i} className="rw" style={{ animation: `fadeIn .2s ease ${Math.min(i * .015, .5)}s both`, borderBottom: "1px solid #0e1218", transition: "background .1s" }}>
                    <td style={{ ...S.td, width: 36 }}>{r._new && <span style={S.newB}>NEW</span>}</td>
                    <td style={{ ...S.td, color: "#4b5563", whiteSpace: "nowrap" }}>{r.date || "—"}</td>
                    <td style={S.td}><span style={{ ...S.badge, color: RC[r._region] || "#4b5563" }}>{r.country || r._region}</span></td>
                    <td style={S.td}><span style={{ ...S.badge, borderColor: (CC[r._cat] || "#4b5563") + "22", color: CC[r._cat] || "#4b5563" }}>{r._cat === "crypto" ? "crypto" : "insider"}</span></td>
                    <td style={{ ...S.td, maxWidth: 380 }}>
                      {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={S.link}>{r.title}</a> : <span>{r.title}</span>}
                      {r.notice_id && <div style={{ fontSize: 9, color: "#1e2733", marginTop: 1 }}>{r.notice_id}</div>}
                    </td>
                    <td style={{ ...S.td, color: "#4b5563", maxWidth: 200 }}>{r.buyer || "—"}</td>
                    <td style={{ ...S.td, color: "#1e2733", whiteSpace: "nowrap", fontSize: 10 }}>{r._label}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>)}

        {tab === "health" && (
          <div style={{ paddingTop: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {[{ n: db.items.length, l: "Cached", c: "#e5e7eb" }, { n: newCt, l: "New 24h", c: "#4ade80" }, { n: BATCHES.length, l: "Calls/run", c: "#a78bfa" }, { n: `${MIN_COOLDOWN / 60000}m`, l: "Cooldown", c: "#fbbf24" }].map((c) => (
                <div key={c.l} style={S.card}><div style={{ fontSize: 20, fontWeight: 700, color: c.c }}>{c.n}</div><div style={{ fontSize: 10, color: "#374151", marginTop: 2 }}>{c.l}</div></div>
              ))}
            </div>
            <div style={S.sec}>Per Source</div>
            <table style={S.tbl}>
              <thead><tr>{["Source", "Batch", "Status", "Pulled", "New", "Last Scan", "Error"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{SOURCES.map((s) => { const x = sts[s.id] || {}; const b = BATCHES.find((batch) => batch.sourceIds.includes(s.id)); const scn = db.scanned?.[s.id]; const colors = { ok: "#4ade80", err: "#f87171", load: "#eab308", wait: "#4b5563" }; const labels = { ok: "✓", err: "✗", load: "⟳", wait: "◦" }; return (
                <tr key={s.id} style={{ borderBottom: "1px solid #0e1218" }}>
                  <td style={{ ...S.td, fontSize: 11 }}>{s.label}</td>
                  <td style={{ ...S.td, fontSize: 10, color: "#374151" }}>{b?.label || "—"}</td>
                  <td style={{ ...S.td, fontSize: 11, color: colors[x.st] || "#374151" }}>{labels[x.st] || "—"}</td>
                  <td style={{ ...S.td, fontSize: 11, color: x.pull === 0 && x.st === "ok" ? "#f87171" : "#d1d5db" }}>{x.pull ?? "—"}{x.pull === 0 && x.st === "ok" && <span style={{ color: "#f87171", marginLeft: 4, fontSize: 9 }}>⚠</span>}</td>
                  <td style={{ ...S.td, fontSize: 11, color: x.add > 0 ? "#4ade80" : "#4b5563" }}>{x.add ?? "—"}</td>
                  <td style={{ ...S.td, fontSize: 10, color: "#4b5563" }}>{scn ? new Date(scn).toLocaleString() : "—"}</td>
                  <td style={{ ...S.td, fontSize: 10, color: "#f87171", maxWidth: 250, wordBreak: "break-all" }}>{x.err || ""}</td>
                </tr>); })}</tbody>
            </table>
            {db.runs.length > 0 && (<><div style={S.sec}>Run History</div><table style={S.tbl}><thead><tr>{["Time", "New", "OK", "Errors"].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead><tbody>{db.runs.map((r, i) => (<tr key={i} style={{ borderBottom: "1px solid #0e1218" }}><td style={{ ...S.td, fontSize: 10, color: "#4b5563" }}>{new Date(r.t).toLocaleString()}</td><td style={{ ...S.td, fontSize: 11, color: r.tot > 0 ? "#4ade80" : "#4b5563" }}>{r.tot}</td><td style={{ ...S.td, fontSize: 11, color: "#4ade80" }}>{r.ok ?? "—"}</td><td style={{ ...S.td, fontSize: 11, color: r.err > 0 ? "#f87171" : "#4b5563" }}>{r.err ?? "—"}</td></tr>))}</tbody></table></>)}
          </div>
        )}
      </div>
    </div>
  );
}

const S = {
  root: { minHeight: "100vh", background: "#080b10", color: "#d1d5db", fontFamily: "'IBM Plex Mono','Fira Code','Courier New',monospace", fontSize: 12 },
  loading: { minHeight: "100vh", background: "#080b10", display: "flex", alignItems: "center", justifyContent: "center", color: "#4b5563", fontFamily: "monospace" },
  hdr: { borderBottom: "1px solid #151b24", padding: "14px 20px", background: "#0a0e14" },
  title: { fontSize: 15, fontWeight: 700, fontFamily: "'IBM Plex Sans',sans-serif", color: "#f0f6fc" },
  sub: { fontSize: 10, color: "#374151", marginTop: 2 },
  tab: { padding: "5px 12px", border: "1px solid #151b24", borderRadius: 5, background: "transparent", color: "#4b5563", cursor: "pointer", fontSize: 10, fontFamily: "inherit" },
  tabOn: { border: "1px solid #1e2733", background: "#111820", color: "#e5e7eb", fontWeight: 600 },
  statusBar: { borderBottom: "1px solid #151b24", padding: "8px 20px", background: "#090d12", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 10 },
  fRow: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "12px 0", borderBottom: "1px solid #151b24" },
  inp: { background: "#0d1117", color: "#c9d1d9", border: "1px solid #1e2733", borderRadius: 5, padding: "6px 9px", fontSize: 11, fontFamily: "inherit" },
  ghost: { padding: "5px 10px", border: "1px solid #1e2733", borderRadius: 5, background: "transparent", color: "#4b5563", cursor: "pointer", fontSize: 10, fontFamily: "inherit" },
  stopBtn: { padding: "7px 14px", border: "1px solid #7f1d1d", borderRadius: 5, background: "#180a0a", color: "#f87171", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 600 },
  goBtn: { padding: "7px 14px", border: "1px solid #14532d", borderRadius: 5, background: "#071209", color: "#4ade80", fontSize: 11, fontFamily: "inherit", fontWeight: 600 },
  empty: { textAlign: "center", padding: "60px 20px", color: "#374151" },
  tbl: { width: "100%", borderCollapse: "collapse", marginTop: 2 },
  th: { textAlign: "left", padding: "8px 5px", fontSize: 9, color: "#374151", fontWeight: 600, borderBottom: "1px solid #151b24", textTransform: "uppercase", letterSpacing: ".5px", position: "sticky", top: 0, background: "#080b10", zIndex: 1 },
  td: { padding: "7px 5px", verticalAlign: "top" },
  badge: { fontSize: 9, padding: "1px 5px", borderRadius: 3, border: "1px solid #1e2733" },
  newB: { fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "#052e16", color: "#4ade80", fontWeight: 700 },
  link: { color: "#93c5fd", textDecoration: "none", lineHeight: 1.35 },
  card: { background: "#0d1117", border: "1px solid #151b24", borderRadius: 6, padding: "12px 16px", minWidth: 90 },
  sec: { fontSize: 11, fontWeight: 600, color: "#6b7280", margin: "16px 0 6px", fontFamily: "'IBM Plex Sans',sans-serif" },
};
