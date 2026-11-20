/* On My Radar: one canvas renderer for the lock screen frames, the live page and PNG export.
   Colours follow the FAA national colour standard for terminal displays (JO 7210.3, 3-9-1):
   black background, dim gray range rings and compass rose, white owned data blocks, green unowned
   (limited) data blocks, blue history trails, yellow highlight, red warning. */
(function () {
  "use strict";
  const DAY = 86400000;
  const dn = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
  const ds = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const md = (s) => `${MON[+s.slice(5, 7) - 1]} ${+s.slice(8, 10)}`;
  const dmd = (s) => `${DOW[new Date(dn(s) * DAY).getUTCDay()]} ${md(s)}`;

  const C = {
    bg: "#000000", ring: "#3c434b", ringLabel: "#98a1aa", map: "#232a31", mapLabel: "#7c858e",
    white: "#f2f5f7", green: "#52d97c", yellow: "#ffd21f", blue: "#4c8bff", red: "#ff4b3e",
    gray: "#9aa3ac", dim: "#5d666f", panel: "#0b0e11", line: "#1f252b",
  };
  const MONO = '"B612 Mono", Menlo, monospace';
  const SANS = '"B612", "Avenir Next", system-ui, sans-serif';
  const font = (w, px, fam) => `${w} ${px}px ${fam}`;

  /* ---------------- model ---------------- */
  // gap rule: 2 days between landings, 3 days behind a HEAVY
  const sepAfter = (a) => (a.heavy ? 3 : 2);

  function state(plan, date, opts = {}) {
    const today = dn(date);
    const skips = opts.skips || {}; // { "YYYY-MM-DD": true } days whose clearance was not done
    const arr = plan.arrivals.map((a) => ({ ...a }));
    // a skipped day pushes that arrival's landing back a day (it goes around), exams cannot move
    for (const [d, on] of Object.entries(skips)) {
      if (!on || dn(d) >= today) continue;
      const t = plan.days[d];
      const a = t && arr.find((x) => x.id === t[0]);
      if (a && !a.fixed) { a.goAround = (a.goAround || 0) + 1; a.slot = ds(dn(a.slot) + 1); }
    }
    arr.sort((a, b) => dn(a.slot) - dn(b.slot) || (a.fixed ? -1 : 1));
    arr.forEach((a, i) => {
      a.seq = plan.arrivals.findIndex((x) => x.id === a.id) + 1;
      a.d = dn(a.slot) - today;
      a.dBegin = dn(a.begin) - today;
      a.slack = dn(a.due) - dn(a.slot);
      a.status = a.d < 0 ? "landed" : a.d === 0 ? "landing" : a.dBegin <= 0 ? "owned" : "unowned";
      a.fuel = a.slack < 0 ? "late" : a.slack === 0 && !a.fixed && a.goAround ? "min" : "";
      a.ca = false;
    });
    // conflict alert: two consecutive landings closer than the separation rule
    for (let i = 1; i < arr.length; i++) {
      const gap = dn(arr[i].slot) - dn(arr[i - 1].slot);
      arr[i].gap = gap; arr[i].gapNeed = sepAfter(arr[i - 1]); arr[i].wake = arr[i - 1].heavy;
      if (gap < arr[i].gapNeed && arr[i].status !== "landed") { arr[i].ca = true; arr[i - 1].ca = arr[i - 1].status !== "landed"; }
    }
    const t = plan.days[date];
    const lastSlot = arr.reduce((m, a) => Math.max(m, dn(a.slot)), 0);
    return {
      date, today, arr, task: t ? { id: t[0], text: t[1] } : null,
      last: ds(lastSlot), daysLeft: lastSlot - today,
      landed: arr.filter((a) => a.status === "landed").length,
      done: arr.every((a) => a.status === "landed"),
      before: today < dn(plan.start),
    };
  }

  /* ---------------- drawing helpers ---------------- */
  function text(ctx, s, x, y, f, color, align = "left", ls = 0, base = "alphabetic") {
    ctx.font = f; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
    ctx.letterSpacing = ls ? ls + "px" : "0px";
    ctx.fillText(s, x, y);
    ctx.letterSpacing = "0px";
  }
  function measure(ctx, s, f, ls = 0) {
    ctx.font = f; ctx.letterSpacing = ls ? ls + "px" : "0px";
    const w = ctx.measureText(s).width; ctx.letterSpacing = "0px"; return w;
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const pol = (cx, cy, r, brg) => [cx + r * Math.sin((brg * Math.PI) / 180), cy - r * Math.cos((brg * Math.PI) / 180)];
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  function rangeFor(st) {
    const live = st.arr.filter((a) => a.status !== "landed");
    const m = Math.max(1, ...live.map((a) => a.d));
    return m <= 7 ? 7 : m <= 14 ? 14 : m <= 21 ? 21 : 28;
  }

  /* ---------------- the scope ---------------- */
  function drawScope(ctx, st, g) {
    const { cx, cy, R } = g;
    const range = rangeFor(st);
    const ppd = R / range;
    const fr = g.frac || 0;
    g.range = range;

    // faint scope face
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    grd.addColorStop(0, "#0a1016"); grd.addColorStop(1, "#030507");
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // compass rose (dim gray)
    ctx.strokeStyle = C.ring; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    for (let b = 0; b < 360; b += 5) {
      const len = b % 30 === 0 ? 26 : b % 10 === 0 ? 15 : 8;
      const [x1, y1] = pol(cx, cy, R, b), [x2, y2] = pol(cx, cy, R + len, b);
      ctx.lineWidth = b % 30 === 0 ? 3 : 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // range rings
    const step = range <= 7 ? 1 : 7;
    ctx.lineWidth = 2;
    for (let d = step; d < range; d += step) {
      ctx.strokeStyle = range <= 7 && d % 7 ? "#262c32" : C.ring;
      ctx.beginPath(); ctx.arc(cx, cy, d * ppd, 0, Math.PI * 2); ctx.stroke();
    }
    // arrival routes (video map, dim)
    const live = st.arr.filter((a) => a.status !== "landed" && a.status !== "landing");
    ctx.strokeStyle = C.map; ctx.lineWidth = 3; ctx.setLineDash([]);
    for (const a of live) {
      const [x, y] = pol(cx, cy, R, a.brg);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
    }
    // runway 18/36 at the centre (Dec 18 lands on runway 18)
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = "#0c0f12"; ctx.strokeStyle = "#aab3bb"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.rect(-9, -46, 18, 92); ctx.fill(); ctx.stroke();
    ctx.setLineDash([10, 9]); ctx.strokeStyle = "#5c656e"; ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, 36); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    if (!g.noTags) text(ctx, "RWY " + (g.runway || "18"), cx + 22, cy + 46, font(700, 26, MONO), "#7c858e", "left");
    g.avoid = [...(g.avoid || []), { x: cx + 16, y: cy + 20, w: 110, h: 34 }];

    // ring labels along the 160 deg bearing
    const labels = [];
    for (let d = step; d <= range && !st.done && !g.noTags; d += step) {
      if (range <= 7 && d !== 3 && d !== 5 && d !== 7) continue;
      const [x, y] = pol(cx, cy, d * ppd, 162);
      const s = d + "D";
      const f = font(700, 34, MONO), w = measure(ctx, s, f);
      ctx.fillStyle = C.bg; ctx.fillRect(x - w / 2 - 8, y - 22, w + 16, 44);
      text(ctx, s, x, y + 1, f, C.ringLabel, "center", 0, "middle");
      labels.push({ x: x - w / 2 - 8, y: y - 22, w: w + 16, h: 44 });
    }
    g.ringLabels = labels;

    // history trails (blue), predicted track lines (white), targets
    const items = [];
    for (const a of st.arr) {
      if (a.status === "landed") continue;
      const r = Math.max(0, a.d - (a.status === "landing" ? 0 : fr)) * ppd;
      const [x, y] = pol(cx, cy, r, a.brg);
      for (let k = 10; k >= 1; k--) {
        const rr = (a.d + k - fr) * ppd; if (rr > R - 6) continue;
        const [hx, hy] = pol(cx, cy, rr, a.brg);
        ctx.globalAlpha = 0.95 - k * 0.07; ctx.fillStyle = C.blue;
        ctx.beginPath(); ctx.arc(hx, hy, 8.5 - k * 0.45, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (a.status === "owned" && a.d >= 1) {
        const [px, py] = pol(cx, cy, Math.max(0, a.d - 1 - fr) * ppd, a.brg);
        ctx.strokeStyle = C.white; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(px, py); ctx.stroke();
      }
      items.push({ a, x, y });
    }
    // labels & targets
    placeTags(ctx, st, items, g);
  }

  function tagLines(a, st) {
    const isToday = st.task && st.task.id === a.id;
    const color = a.ca || a.fuel === "late" ? C.red : isToday || a.status === "landing" ? C.yellow : a.status === "unowned" ? C.green : C.white;
    const l1 = (a.heavy ? "H/" : "") + a.name;
    let l2;
    if (a.status === "landing") l2 = a.fixed ? "EXAM TODAY" : "LANDING TODAY";
    else if (a.status === "unowned") l2 = "START " + md(a.begin);
    else l2 = `${md(a.slot)} · ${a.d}D`;
    const extra = a.ca ? "CA" : a.fuel === "late" ? "PAST DUE" : a.fuel === "min" ? "MIN FUEL" : "";
    return { color, isToday, l1, l2, extra };
  }

  function placeTags(ctx, st, items, g) {
    const { cx, cy, R } = g;
    const placed = [...(g.ringLabels || []), ...(g.avoid || [])];
    const targets = items.map((it) => ({ x: it.x - 24, y: it.y - 24, w: 48, h: 48 }));
    const order = [...items].sort((p, q) => {
      const pr = (it) => (st.task && st.task.id === it.a.id ? 0 : it.a.status === "landing" ? 1 : it.a.status === "owned" ? 2 : 3);
      return pr(p) - pr(q) || p.a.d - q.a.d;
    });
    const f1 = font(700, 42, MONO), f2 = font(400, 38, MONO);
    const out = [];
    for (const it of g.noTags ? [] : order) {
      const L = tagLines(it.a, st);
      const w = Math.max(measure(ctx, L.l1, f1, -2), measure(ctx, L.l2 + (L.extra ? "  " + L.extra : ""), f2, -2)) + 24;
      const h = 104;
      let best = null;
      const outward = it.a.status === "landing" ? 0 : (it.a.brg * Math.PI) / 180;
      for (let ang = 0; ang < 360; ang += 22.5) {
        for (const len of [58, 92, 130, 175]) {
          const t = (ang * Math.PI) / 180, dx = Math.sin(t), dy = -Math.cos(t);
          const px = it.x + dx * len, py = it.y + dy * len;
          const x = dx > 0.35 ? px + 6 : dx < -0.35 ? px - 6 - w : px - w / 2;
          const y = dy < -0.35 ? py - h - 4 : dy > 0.35 ? py + 4 : py - h / 2;
          const rect = { x, y, w, h };
          let sc = len * 0.25;
          if (x < (g.minX || 18) || x + w > (g.maxX || 1272) || y < g.top || y + h > g.bottom) sc += 1e6;
          for (const p of placed) sc += overlap(rect, p) * 3;
          targets.forEach((tr, i) => { sc += overlap(rect, tr) * (items[i] === it ? 12 : 6); });
          // keep tags off the runway and prefer pointing away from the centre
          sc += overlap(rect, { x: cx - 40, y: cy - 60, w: 80, h: 120 }) * 4;
          if (it.a.status !== "landing") sc -= Math.cos(t - outward) * 40;
          if (Math.abs(dx) < 0.35) sc += 30;
          if (!best || sc < best.sc) best = { sc, rect, px, py, dx, dy };
        }
      }
      placed.push(best.rect);
      out.push({ it, L, best, f1, f2 });
    }
    // draw leaders, then targets, then tags
    for (const o of out) {
      if (o.noTag) continue;
      const { it, L, best } = o;
      const r = best.rect;
      const ex = best.dx > 0.35 ? r.x : best.dx < -0.35 ? r.x + r.w : r.x + r.w / 2;
      const ey = best.dy < -0.35 ? r.y + r.h : best.dy > 0.35 ? r.y : r.y + r.h / 2;
      ctx.strokeStyle = L.color; ctx.lineWidth = 2.5; ctx.beginPath();
      const t = Math.atan2(ey - it.y, ex - it.x);
      ctx.moveTo(it.x + Math.cos(t) * 22, it.y + Math.sin(t) * 22); ctx.lineTo(ex, ey); ctx.stroke();
    }
    if (g.noTags) for (const it of items) out.push({ it, L: tagLines(it.a, st), noTag: true });
    for (const o of out) {
      const { it, L } = o;
      ctx.save(); ctx.shadowColor = "rgba(76,139,255,0.85)"; ctx.shadowBlur = 22;
      ctx.fillStyle = C.blue; ctx.beginPath(); ctx.arc(it.x, it.y, 20, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      if (L.isToday || it.a.status === "landing") {
        ctx.save(); ctx.shadowColor = "rgba(255,210,31,0.7)"; ctx.shadowBlur = 18;
        ctx.strokeStyle = C.yellow; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(it.x, it.y, 27, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      text(ctx, String(it.a.seq), it.x, it.y + 2, font(700, 30, MONO), "#ffffff", "center", 0, "middle");
    }
    for (const o of out) {
      if (o.noTag) continue;
      const { L, best, f1, f2 } = o;
      const r = best.rect;
      ctx.fillStyle = "rgba(0,0,0,0.82)"; ctx.fillRect(r.x, r.y, r.w, r.h);
      if (L.isToday) { ctx.strokeStyle = C.yellow; ctx.lineWidth = 3; ctx.strokeRect(r.x, r.y, r.w, r.h); }
      text(ctx, L.l1, r.x + 12, r.y + 46, f1, L.color, "left", -2);
      text(ctx, L.l2, r.x + 12, r.y + 90, f2, L.color, "left", -2);
      if (L.extra) text(ctx, L.extra, r.x + r.w - 12, r.y + 90, font(700, 38, MONO), C.red, "right");
    }
  }

  /* ---------------- lock screen layout (1290 x 2796) ---------------- */
  function drawLock(ctx, st, plan, opts) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 1290, 2796);
    const g = { cx: 645, cy: 1652, R: 486, top: 1140, bottom: 2168, frac: opts.frac || 0, runway: plan.runway };

    // header
    text(ctx, (plan.title || "FINALS") + " APPROACH", 70, 992, font(700, 34, SANS), C.gray, "left", 5);
    if (!st.done) {
      const big = font(700, 132, SANS);
      const n = st.daysLeft === 0 ? "TODAY" : String(st.daysLeft);
      text(ctx, n, 62, 1124, big, C.white);
      const nw = measure(ctx, n, big);
      if (st.daysLeft > 0) text(ctx, st.daysLeft === 1 ? "DAY" : "DAYS", 62 + nw + 18, 1124, font(700, 54, SANS), C.white);
      text(ctx, "LAST LANDING", 1222, 1062, font(700, 34, SANS), C.gray, "right", 4);
      text(ctx, dmd(st.last), 1222, 1124, font(700, 60, SANS), C.white, "right");
    } else {
      text(ctx, "ALL TRAFFIC LANDED", 62, 1118, font(700, 92, SANS), C.white);
    }
    text(ctx, `RANGE ${rangeFor(st)}D`, 1222, 992, font(700, 34, SANS), C.gray, "right", 4);

    drawScope(ctx, st, g);
    if (st.done) {
      text(ctx, `${st.arr.length} OF ${st.arr.length} LANDED`, g.cx, g.cy - 120, font(700, 64, MONO), C.green, "center");
      text(ctx, "FINALS COMPLETE", g.cx, g.cy + 150, font(700, 48, MONO), C.gray, "center", 4);
    }

    // clearance strip
    const y0 = 2192;
    ctx.fillStyle = C.panel; rrect(ctx, 50, y0, 1190, 128, 18); ctx.fill();
    ctx.strokeStyle = st.task ? C.yellow : C.line; ctx.lineWidth = 3; rrect(ctx, 50, y0, 1190, 128, 18); ctx.stroke();
    if (st.task) {
      const a = st.arr.find((x) => x.id === st.task.id);
      const landing = a && a.status === "landing";
      const lab = landing ? "TODAY · " + a.name + " · CLEARED TO LAND" : "TODAY'S CLEARANCE · " + (a ? a.name : st.task.id);
      text(ctx, lab, 82, y0 + 46, font(700, 32, SANS), C.yellow, "left", 3);
      let f = 56; while (measure(ctx, st.task.text, font(700, f, SANS)) > 1120 && f > 40) f -= 2;
      text(ctx, st.task.text, 82, y0 + 106, font(700, f, SANS), C.white);
    } else if (st.done) {
      text(ctx, "CLEARED: WINTER BREAK", 82, y0 + 46, font(700, 32, SANS), C.green, "left", 3);
      text(ctx, st.arr.length === 6 ? "Sleep in. You landed all six." : "Sleep in. Everything landed.", 82, y0 + 106, font(700, 56, SANS), C.white);
    }

    // landing sequence ladder
    drawLadder(ctx, st, 50, 2352, 1190, 128);
  }

  function drawLadder(ctx, st, x0, y0, W, H) {
    const n = st.arr.length, gap = 12, cw = (W - gap * (n - 1)) / n;
    const nextId = (st.arr.find((a) => a.status !== "landed") || {}).id;
    st.arr.forEach((a, i) => {
      const x = x0 + i * (cw + gap);
      const landed = a.status === "landed", next = a.id === nextId, today = st.task && st.task.id === a.id;
      const col = landed ? C.green : a.ca ? C.red : today ? C.yellow : C.white;
      ctx.fillStyle = landed ? "#07140c" : C.panel; rrect(ctx, x, y0, cw, H, 14); ctx.fill();
      ctx.strokeStyle = landed ? "#1f6b3a" : a.ca ? C.red : today ? C.yellow : C.line; ctx.lineWidth = 3; rrect(ctx, x, y0, cw, H, 14); ctx.stroke();
      text(ctx, landed ? "✓ LANDED" : `#${a.seq}` + (next ? " NEXT" : ""), x + 16, y0 + 36, font(700, 26, SANS), landed ? C.green : next ? C.white : C.gray, "left", 1);
      text(ctx, a.course, x + 16, y0 + 80, font(700, 40, SANS), col);
      text(ctx, md(a.slot), x + 16, y0 + 116, font(700, 30, MONO), landed ? "#5aa877" : C.gray, "left", -1);
      if (a.due !== a.slot && !landed) text(ctx, "DUE " + +a.due.slice(8, 10), x + cw - 12, y0 + 36, font(700, 22, MONO), landed ? "#5aa877" : C.gray, "right", -1);
    });
    // separation between landings, drawn on the gaps
    st.arr.forEach((a, i) => {
      if (!i) return;
      const x = x0 + i * (cw + gap) - gap / 2;
      const s = a.wake ? `${a.gap}D WAKE` : `${a.gap}D`;
      const f = font(700, 22, MONO), w = measure(ctx, s, f) + 14;
      ctx.fillStyle = "#000"; rrect(ctx, x - w / 2, y0 - 18, w, 34, 10); ctx.fill();
      ctx.strokeStyle = a.ca ? C.red : C.dim; ctx.lineWidth = 2; rrect(ctx, x - w / 2, y0 - 18, w, 34, 10); ctx.stroke();
      text(ctx, s, x, y0 - 0, f, a.ca ? C.red : C.gray, "center", 0, "middle");
    });
  }

  function drawIOS(ctx, date) {
    const d = new Date(dn(date) * DAY);
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const mons = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const sys = '-apple-system, "SF Pro Display", system-ui, sans-serif';
    ctx.fillStyle = "#000"; rrect(ctx, 456, 33, 378, 111, 56); ctx.fill();
    text(ctx, `${days[d.getUTCDay()]}, ${mons[d.getUTCMonth()]} ${d.getUTCDate()}`, 645, 262, font(600, 62, sys), "rgba(255,255,255,.92)", "center");
    text(ctx, "9:41", 645, 560, font(700, 318, sys), "rgba(255,255,255,.95)", "center");
    for (const x of [213, 1077]) { ctx.fillStyle = "rgba(40,44,52,.75)"; ctx.beginPath(); ctx.arc(x, 2605, 75, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#fff"; rrect(ctx, 435, 2755, 420, 15, 8); ctx.fill();
  }

  function draw(ctx, W, H, plan, date, opts = {}) {
    const st = state(plan, date, opts);
    ctx.save();
    if (opts.mode === "scope") {
      const s = W / 1100; ctx.scale(s, s);
      if (!opts.transparent) { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 1100, 1100); }
      const g = { cx: 550, cy: 550, R: 470, top: 10, bottom: 1090, minX: 10, maxX: 1090, frac: opts.frac || 0, runway: plan.runway, noTags: !!opts.noTags };
      drawScope(ctx, st, g);
      if (st.done) text(ctx, "ALL TRAFFIC LANDED", 550, 430, font(700, 60, MONO), C.green, "center");
    } else {
      const s = W / 1290; ctx.scale(s, s);
      drawLock(ctx, st, plan, opts);
      if (opts.clock) drawIOS(ctx, date);
    }
    ctx.restore();
    return st;
  }

  window.Radar = { draw, state, dn, ds, md, dmd, rangeFor, C };
})();
