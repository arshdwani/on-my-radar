/* On My Radar: live page. Scope animation, progress ticks (go-arounds), exports, and a sequencer for your own deadlines. */
(function () {
  "use strict";
  const { dn, ds, md, dmd } = Radar;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  /* ---------------- sequencer for your own deadlines ---------------- */
  const sepAfter = (a) => (a.heavy ? 3 : 2);
  function permutations(n) {
    const out = [], a = [...Array(n).keys()], c = Array(n).fill(0);
    out.push(a.slice());
    let i = 0;
    while (i < n) {
      if (c[i] < i) { const j = i % 2 ? c[i] : 0; [a[j], a[i]] = [a[i], a[j]]; out.push(a.slice()); c[i]++; i = 0; }
      else { c[i] = 0; i++; }
    }
    return out;
  }
  function sequence(items, todayStr) {
    const today = dn(todayStr);
    const n = items.length;
    const orders = n <= 7 ? permutations(n) : [items.map((_, i) => i).sort((p, q) => dn(items[p].due) - dn(items[q].due))];
    let best = null;
    for (const ord of orders) {
      const slot = Array(n); let conflicts = 0, cost = 0;
      for (let k = n - 1; k >= 0; k--) {
        const it = items[ord[k]];
        let s = dn(it.due);
        if (k < n - 1) s = Math.min(s, slot[ord[k + 1]] - sepAfter(it));
        if (it.fixed && s < dn(it.due)) { conflicts++; s = dn(it.due); }
        if (s < today) { conflicts++; s = Math.max(s, today); }
        slot[ord[k]] = s; cost += (dn(it.due) - s) * (it.heavy ? 1.5 : 1);
      }
      for (let k = 1; k < n; k++) if (slot[ord[k]] - slot[ord[k - 1]] < sepAfter(items[ord[k - 1]])) conflicts++;
      const score = conflicts * 1000 + cost;
      if (!best || score < best.score) best = { score, slot, conflicts };
    }
    // conflicts in the official due dates (what approach control had to fix)
    const byDue = items.map((it, i) => ({ it, i })).sort((p, q) => dn(p.it.due) - dn(q.it.due));
    const clashes = [];
    for (let k = 1; k < byDue.length; k++) {
      const a = byDue[k - 1].it, b = byDue[k].it, gap = dn(b.due) - dn(a.due);
      if (gap < sepAfter(a)) clashes.push(`${a.name} and ${b.name} are due ${gap * 24} h apart`);
    }
    return { slots: best.slot.map(ds), unresolved: best.conflicts, clashes };
  }

  const FIXES = ["ALPHA", "BRAVO", "COBRA", "DELTA", "ECHOS", "FOXXY", "GOLFS", "HOTEL"];
  function buildPlan(items, tasks, todayStr) {
    const seq = sequence(items, todayStr);
    const arrivals = items.map((it, i) => {
      const slot = seq.slots[i];
      const lead = it.heavy ? 10 : 4;
      return {
        id: "A" + i, name: it.name.toUpperCase().slice(0, 12), course: it.name.toUpperCase().split(/\s+/)[0].slice(0, 6),
        kind: "", heavy: !!it.heavy, fixed: !!it.fixed, due: it.due, slot,
        begin: ds(Math.max(dn(todayStr), dn(slot) - lead)), fix: FIXES[i % 8], brg: 0,
      };
    }).sort((a, b) => dn(a.slot) - dn(b.slot));
    // spread bearings, keeping clear of due north (the header sits above the scope)
    const n = arrivals.length;
    arrivals.forEach((a, i) => { a.brg = Math.round((40 + (i * 280) / Math.max(1, n - 1) + (i % 2) * 25) % 360); });
    const last = Math.max(...arrivals.map((a) => dn(a.slot)));
    const first = dn(todayStr);
    const days = {};
    // your own tasks win
    for (const t of tasks) {
      const a = arrivals.find((x) => x.name === t.name.toUpperCase().slice(0, 12));
      if (a && dn(t.date) >= first && dn(t.date) <= dn(a.slot)) days[t.date] = [a.id, t.task.slice(0, 32)];
    }
    // then work backward from each landing: the slot day, then the latest free days before it
    const need = (a) => (a.fixed ? (a.heavy ? 4 : 3) : a.heavy ? 6 : 3);
    for (const a of arrivals) days[a.slot] = [a.id, a.fixed ? "Exam: " + a.name : "Final pass, submit " + a.name];
    for (const a of [...arrivals].sort((p, q) => dn(q.slot) - dn(p.slot))) {
      let left = need(a) - Object.values(days).filter((v) => v[0] === a.id).length;
      for (let d = dn(a.slot) - 1; d >= first && left > 0; d--) {
        if (!days[ds(d)]) { days[ds(d)] = [a.id, (a.fixed ? "Study for " : "Work on ") + a.name]; left--; }
      }
    }
    // free days left over: get ahead on whatever lands next
    for (let d = first; d <= last; d++) {
      if (days[ds(d)]) continue;
      const nx = arrivals.filter((x) => dn(x.slot) > d).sort((p, q) => dn(p.slot) - dn(q.slot))[0];
      if (nx) days[ds(d)] = [nx.id, "Get ahead: " + nx.name];
    }
    // an arrival is handed to you (turns white) on the first day you work on it
    for (const a of arrivals) {
      const ds0 = Object.keys(days).filter((k) => days[k][0] === a.id).sort()[0];
      a.begin = ds0 || a.slot;
    }
    const lastDay = +ds(last).slice(8, 10);
    return { title: "MY", runway: String(lastDay), start: todayStr, arrivals, days, custom: true, seq };
  }

  function parsePlanText(txt) {
    const items = [], tasks = [];
    for (const raw of txt.split(/\n/)) {
      const line = raw.trim(); if (!line || line.startsWith("#")) continue;
      const parts = line.split(",").map((s) => s.trim());
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) && parts.length >= 3) { tasks.push({ date: parts[0], name: parts[1], task: parts.slice(2).join(", ") }); continue; }
      if (parts.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
        const flags = parts.slice(2).join(" ").toUpperCase();
        items.push({ name: parts[0], due: parts[1], heavy: /\bH\b|HEAVY/.test(flags), fixed: /\bX\b|EXAM|FIXED/.test(flags) });
      }
    }
    return { items: items.slice(0, 8), tasks };
  }
  function parseICS(txt) {
    const out = [];
    const un = txt.replace(/\r?\n[ \t]/g, "");
    for (const ev of un.split("BEGIN:VEVENT").slice(1)) {
      const sum = (ev.match(/\nSUMMARY[^:]*:(.*)/) || [])[1];
      const dt = (ev.match(/\nDTSTART[^:]*:(\d{8})/) || [])[1];
      if (sum && dt) out.push(`${sum.replace(/\\,/g, " ").replace(/,/g, " ").trim().slice(0, 24)}, ${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`);
    }
    return out;
  }

  /* ---------------- state ---------------- */
  const SAMPLE_TEXT = PLAN.arrivals.map((a) => `${a.name}, ${a.due}${a.heavy ? ", H" : ""}${a.fixed ? ", X" : ""}`).join("\n");
  let plan = PLAN;
  let planKey = "sample";
  const realToday = ds(Math.floor(Date.now() / 86400000));
  let date = PLAN.start;
  let frac = 0, playing = false;

  function lastDay() { return ds(Math.max(...plan.arrivals.map((a) => dn(a.slot))) + 1); }
  function clampDate(d) { return ds(Math.min(Math.max(dn(d), dn(plan.start)), dn(lastDay()))); }

  function skips() { return store.get("omr-skips-" + planKey) || {}; }
  function setSkip(d, on) { const s = skips(); if (on) s[d] = true; else delete s[d]; store.set("omr-skips-" + planKey, s); }

  /* ---------------- drawing ---------------- */
  const scope = $("scope"), phone = $("phone");
  function fitCanvas(c, w, h) { if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
  function render() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const sw = Math.round(scope.clientWidth * dpr);
    fitCanvas(scope, sw, sw);
    const st = Radar.draw(scope.getContext("2d"), sw, sw, plan, date, { mode: "scope", skips: skips(), frac });
    const pw = Math.round(phone.clientWidth * dpr);
    fitCanvas(phone, pw, Math.round((pw * 2796) / 1290));
    Radar.draw(phone.getContext("2d"), phone.width, phone.height, plan, date, { skips: skips(), frac: 0 });
    panel(st);
  }

  function panel(st) {
    $("dateLabel").textContent = dmd(date);
    $("slider").min = 0; $("slider").max = dn(lastDay()) - dn(plan.start); $("slider").value = dn(date) - dn(plan.start);
    $("countdown").textContent = st.done ? "All traffic landed" : st.daysLeft === 0 ? "Last landing today" : `${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"} to the last landing, ${dmd(st.last)}`;
    const t = st.task, a = t && st.arr.find((x) => x.id === t.id);
    $("clearance").innerHTML = t ? `<span class="k">${a.status === "landing" ? "Cleared to land" : "Today's clearance"} · ${a.name}</span><b>${esc(t.text)}</b>` : st.done ? `<span class="k">Cleared</span><b>Winter break. Everything landed.</b>` : "";
    const rows = st.arr.map((x) => {
      const status = x.status === "landed" ? "Landed" : x.status === "landing" ? "Landing today" : x.status === "owned" ? `Inbound, ${x.d} d` : `Starts ${md(x.begin)}`;
      const warn = x.ca ? ' <em class="ca">CA</em>' : x.fuel === "late" ? ' <em class="ca">PAST DUE</em>' : x.goAround ? ` <em class="ga">GO-AROUND ×${x.goAround}</em>` : "";
      return `<tr class="${x.status}${t && t.id === x.id ? " today" : ""}"><td>${x.seq}</td><td>${x.heavy ? "H/" : ""}${esc(x.name)}</td><td>${md(x.due)}</td><td>${md(x.slot)}</td><td>${x.gap != null ? x.gap + " d" + (x.wake ? " wake" : "") : "–"}</td><td>${status}${warn}</td></tr>`;
    }).join("");
    $("arrivals").innerHTML = rows;
    // progress ticks for past days
    const sk = skips();
    const list = [];
    for (let d = dn(plan.start); d < dn(date); d++) {
      const key = ds(d), tk = plan.days[key]; if (!tk) continue;
      const ar = plan.arrivals.find((x) => x.id === tk[0]);
      list.push(`<label class="tick"><input type="checkbox" data-d="${key}" ${sk[key] ? "" : "checked"}><span>${md(key)}</span><span class="nm">${esc(ar ? ar.name : "")}</span><span class="tx">${esc(tk[1])}</span></label>`);
    }
    $("ticks").innerHTML = list.length ? list.reverse().join("") : '<p class="muted">Nothing to tick yet. Move the date forward.</p>';
    const alerts = st.arr.filter((x) => x.ca && x.status !== "landed");
    $("alert").hidden = !alerts.length;
    $("alert").textContent = alerts.length ? `CONFLICT ALERT: ${alerts.map((x) => x.name).join(" and ")} now land closer than the separation rule allows. Make up the skipped day or move one landing.` : "";
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------------- controls ---------------- */
  function go(d) { date = clampDate(d); frac = 0; render(); }
  $("slider").addEventListener("input", (e) => go(ds(dn(plan.start) + +e.target.value)));
  $("prev").onclick = () => go(ds(dn(date) - 1));
  $("next").onclick = () => go(ds(dn(date) + 1));
  $("today").onclick = () => go(realToday);
  $("ticks").addEventListener("change", (e) => { const d = e.target.dataset.d; if (d) { setSkip(d, !e.target.checked); render(); } });
  $("resetTicks").onclick = () => { store.set("omr-skips-" + planKey, {}); render(); };

  let last = 0;
  function loop(ts) {
    if (!playing) return;
    const dt = last ? (ts - last) / 1000 : 0; last = ts;
    frac += dt / 0.9;
    if (frac >= 1) {
      frac = 0;
      if (dn(date) >= dn(lastDay())) { playing = false; $("play").textContent = "Play the approach"; render(); return; }
      date = ds(dn(date) + 1);
    }
    render();
    requestAnimationFrame(loop);
  }
  $("play").onclick = () => {
    playing = !playing; $("play").textContent = playing ? "Pause" : "Play the approach";
    if (playing) { if (dn(date) >= dn(lastDay())) date = plan.start; last = 0; requestAnimationFrame(loop); } else { frac = 0; render(); }
  };

  /* ---------------- exports ---------------- */
  function frameBlob(d) {
    const c = document.createElement("canvas"); c.width = 1290; c.height = 2796;
    Radar.draw(c.getContext("2d"), 1290, 2796, plan, d, { skips: skips() });
    return new Promise((r) => c.toBlob(r, "image/png"));
  }
  function save(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  $("dlPng").onclick = async () => save(await frameBlob(date), `on-my-radar-${date}.png`);

  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) { // stored (no compression); PNGs are already compressed
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true);
      h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
      c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + sz;
    }
    const csize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: "application/zip" });
  }
  $("dlZip").onclick = async () => {
    const btn = $("dlZip"), label = btn.textContent; const files = [];
    for (let d = dn(plan.start); d <= dn(lastDay()); d++) {
      btn.textContent = `Rendering ${md(ds(d))}…`;
      const b = await frameBlob(ds(d)); files.push({ name: `OnMyRadar/${ds(d)}.png`, data: new Uint8Array(await b.arrayBuffer()) });
    }
    save(zip(files), "OnMyRadar.zip"); btn.textContent = label;
  };
  $("dlIcs").onclick = () => {
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//On My Radar//EN", "CALSCALE:GREGORIAN"];
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const fold = (s) => s.replace(/[\\;,]/g, (c) => "\\" + c);
    for (const [d, [id, task]] of Object.entries(plan.days)) {
      const a = plan.arrivals.find((x) => x.id === id); const D = d.replace(/-/g, "");
      L.push("BEGIN:VEVENT", `UID:omr-${D}-${id}@on-my-radar`, `DTSTAMP:${stamp}`, `DTSTART:${D}T073000`, `DTEND:${D}T074500`,
        `SUMMARY:${fold((dn(a.slot) === dn(d) ? "Cleared to land: " : "Clearance: ") + a.name + " - " + task)}`,
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${fold(a.name + ": " + task)}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
    }
    L.push("END:VCALENDAR");
    save(new Blob([L.join("\r\n")], { type: "text/calendar" }), "on-my-radar-clearances.ics");
  };

  /* ---------------- your own deadlines ---------------- */
  $("planText").value = SAMPLE_TEXT;
  $("icsFile").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const lines = parseICS(await f.text());
    $("planMsg").textContent = lines.length ? `Imported ${lines.length} events. Mark exams with X and big ones with H, then press Sequence.` : "No dated events found in that file.";
    if (lines.length) $("planText").value = lines.slice(0, 8).join("\n");
  });
  function applyCustom(txt, fromHash) {
    const { items, tasks } = parsePlanText(txt);
    if (items.length < 2) { $("planMsg").textContent = "Add at least two deadlines, one per line: name, YYYY-MM-DD."; return false; }
    const start = fromHash && fromHash.start ? fromHash.start : realToday;
    if (items.some((it) => dn(it.due) < dn(start))) { $("planMsg").textContent = "Every due date has to be today or later."; return false; }
    plan = buildPlan(items, tasks, start);
    planKey = "c-" + btoa(unescape(encodeURIComponent(txt))).slice(0, 40);
    const s = plan.seq;
    $("planMsg").innerHTML = (s.clashes.length ? `<b>Conflicts in the due dates:</b> ${s.clashes.map(esc).join("; ")}. ` : "No due dates clash. ") +
      (s.unresolved ? `<b class="ca">${s.unresolved} conflict(s) can't be fixed by finishing earlier</b> (an exam is involved): ask for an extension or accept a tight gap.` : "Every landing now has its separation.");
    try { history.replaceState(null, "", "#p=" + btoa(unescape(encodeURIComponent(JSON.stringify({ t: txt, start }))))); } catch {}
    go(start);
    return true;
  }
  $("sequence").onclick = () => applyCustom($("planText").value);
  $("samplePlan").onclick = () => { plan = PLAN; planKey = "sample"; $("planText").value = SAMPLE_TEXT; $("planMsg").textContent = "Showing the sample plan."; try { history.replaceState(null, "", location.pathname); } catch {} go(PLAN.start); };
  $("share").onclick = async () => { try { await navigator.clipboard.writeText(location.href); $("planMsg").textContent = "Link copied. It carries your deadlines, nothing else."; } catch { $("planMsg").textContent = location.href; } };

  /* ---------------- start ---------------- */
  const fontsReady = Promise.all(['700 40px "B612"', '400 40px "B612"', '700 40px "B612 Mono"', '400 40px "B612 Mono"'].map((f) => document.fonts.load(f)));
  fontsReady.then(() => {
    const m = location.hash.match(/#p=(.+)/);
    if (m) { try { const o = JSON.parse(decodeURIComponent(escape(atob(m[1])))); $("planText").value = o.t; if (applyCustom(o.t, o)) return; } catch {} }
    go(dn(realToday) >= dn(PLAN.start) && dn(realToday) <= dn(lastDay()) ? realToday : PLAN.start);
  });
  let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(render, 120); });
  window.OMR = { sequence, buildPlan, parsePlanText, go, get plan() { return plan; } };
})();
