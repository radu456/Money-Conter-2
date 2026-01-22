/* Buget Zilnic - PWA, GitHub Pages friendly (./ paths), localStorage persistent */

"use strict";

const STORAGE_KEY = "buget_zilnic_v1";

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}
function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function n2(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}
function round2(x) { return Math.round(n2(x) * 100) / 100; }
function fmtRON(x) {
  const v = round2(x);
  return v.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " RON";
}
function fmtNum(x) {
  const v = round2(x);
  return v.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pad2(n){ return String(n).padStart(2,"0"); }
function dateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function monthKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
}
function daysInMonth(year, monthIndex0) {
  // corect pentru orice an (inclusiv bisect)
  return new Date(year, monthIndex0 + 1, 0).getDate();
}
function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59, 999);
}
function daysRemainingIncludingToday(d) {
  const eom = endOfMonth(d);
  // numărăm zile calendaristice inclusiv azi
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(eom.getFullYear(), eom.getMonth(), eom.getDate());
  const diff = Math.round((end - start) / (24*3600*1000));
  return diff + 1;
}

function defaultState() {
  const now = new Date();
  const mk = monthKey(now);

  return {
    v: 1,
    settings: {
      incomePerDay: 100,
      warnThreshold: 65,   // galben
      dangerThreshold: 20  // roșu
    },
    nextMonthPenalties: [], // listă care se aplică la următoarea lună
    refundsPending: [],     // listă globală (nu intră în sold până nu e încasat)
    months: {
      [mk]: {
        createdAt: Date.now(),
        appliedPenaltySum: 0,      // penalizări aplicate la startul lunii (din luna trecută)
        appliedPenaltyItems: [],   // păstrăm lista pentru istoric
        normalExpenses: [],        // {id, dateKey, amount, note, at}
        bigExpenses: [],           // {id, amount, note, at}
        refundsReceived: []        // {id, amount, note, at, fromPendingId?}
      }
    }
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  const data = safeJsonParse(raw, null);
  if (!data || typeof data !== "object") return defaultState();
  // minimal validation
  if (!data.settings) data.settings = defaultState().settings;
  if (!data.months) data.months = {};
  if (!data.nextMonthPenalties) data.nextMonthPenalties = [];
  if (!data.refundsPending) data.refundsPending = [];
  if (!data.v) data.v = 1;
  return data;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Save failed:", e);
    // nu crăpăm aplicația, doar avertizăm
    toast("Nu pot salva în localStorage (spațiu plin / permisiuni).");
  }
}

let state = loadState();

function ensureMonth(mk, now) {
  if (state.months[mk]) return;

  // când intrăm într-o lună nouă, aplicăm penalizările adunate luna trecută
  const penalties = state.nextMonthPenalties || [];
  const penaltySum = round2(penalties.reduce((a,p)=>a+n2(p.amount),0));

  state.months[mk] = {
    createdAt: Date.now(),
    appliedPenaltySum: penaltySum,
    appliedPenaltyItems: penalties.map(p => ({...p})),
    normalExpenses: [],
    bigExpenses: [],
    refundsReceived: []
  };

  // resetăm lista de penalizări pentru următoarea lună
  state.nextMonthPenalties = [];
  saveState();
}

function getMonthObj(mk) {
  return state.months[mk];
}

function monthStartingBudget(mk) {
  const [yy, mm] = mk.split("-").map(Number);
  const monthIndex0 = (mm - 1);
  const dim = daysInMonth(yy, monthIndex0);
  const base = dim * n2(state.settings.incomePerDay);
  const m = getMonthObj(mk);
  const applied = m ? n2(m.appliedPenaltySum) : 0;
  return round2(base - applied);
}

function sumNormalMonth(mk) {
  const m = getMonthObj(mk);
  if (!m) return 0;
  return round2(m.normalExpenses.reduce((a,e)=>a+n2(e.amount),0));
}
function sumNormalBeforeToday(mk, todayKey) {
  const m = getMonthObj(mk);
  if (!m) return 0;
  return round2(m.normalExpenses
    .filter(e => e.dateKey < todayKey)
    .reduce((a,e)=>a+n2(e.amount),0));
}
function sumNormalToday(mk, todayKey) {
  const m = getMonthObj(mk);
  if (!m) return 0;
  return round2(m.normalExpenses
    .filter(e => e.dateKey === todayKey)
    .reduce((a,e)=>a+n2(e.amount),0));
}
function sumBigMonth(mk) {
  const m = getMonthObj(mk);
  if (!m) return 0;
  return round2(m.bigExpenses.reduce((a,e)=>a+n2(e.amount),0));
}
function sumRefundsReceivedMonth(mk) {
  const m = getMonthObj(mk);
  if (!m) return 0;
  return round2(m.refundsReceived.reduce((a,e)=>a+n2(e.amount),0));
}

function computeDashboard(now) {
  const mk = monthKey(now);
  const tk = dateKey(now);
  ensureMonth(mk, now);
  const m = getMonthObj(mk);

  const startBudget = monthStartingBudget(mk);

  const spentBeforeToday = sumNormalBeforeToday(mk, tk);
  const spentToday = sumNormalToday(mk, tk);
  const spentMonthAllNormal = sumNormalMonth(mk);

  const big = sumBigMonth(mk);
  const refundsReceived = sumRefundsReceivedMonth(mk);

  const dLeft = daysRemainingIncludingToday(now);

  // pool-ul de la care se împarte bugetul azi (fără cheltuielile normale din azi)
  const dayBasePool = round2(startBudget - big + refundsReceived - spentBeforeToday);

  const todayAllowance = dLeft > 0 ? round2(dayBasePool / dLeft) : 0;
  const remainToday = round2(todayAllowance - spentToday);

  const remainMonthNow = round2(startBudget - big + refundsReceived - spentMonthAllNormal);

  const tomorrow = (dLeft - 1) > 0 ? round2((dayBasePool - spentToday) / (dLeft - 1)) : round2(remainMonthNow);

  return {
    mk, tk,
    startBudget,
    dLeft,
    spentToday,
    remainToday,
    remainMonthNow,
    tomorrow,
    spentMonthAllNormal,
    big,
    refundsReceived
  };
}

/* UI helpers */
function $(id){ return document.getElementById(id); }

let toastTimer = null;
function toast(msg){
  // simplu: folosim footer info ca “toast”
  const el = $("footInfo");
  if (!el) return;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.textContent = ""; }, 3500);
}

function setHeroColor(value) {
  const v = n2(value);
  const warn = n2(state.settings.warnThreshold);
  const danger = n2(state.settings.dangerThreshold);
  const el = $("remainToday");
  if (!el) return;
  if (v <= danger) el.style.color = "var(--bad)";
  else if (v <= warn) el.style.color = "var(--warn)";
  else el.style.color = "var(--good)";
}

/* Render lists */
function renderTodayList(mk, tk) {
  const m = getMonthObj(mk);
  const list = $("todayList");
  list.innerHTML = "";

  const items = (m.normalExpenses || []).filter(e => e.dateKey === tk).slice().reverse();
  if (!items.length) {
    list.innerHTML = `<div class="hint">Nicio cheltuială azi.</div>`;
    return;
  }

  for (const e of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__left">
        <div class="item__title">${fmtRON(e.amount)}</div>
        <div class="item__sub">${e.note ? escapeHtml(e.note) : "—"} • ${new Date(e.at).toLocaleString("ro-RO")}</div>
      </div>
      <div class="item__right">
        <span class="badge">${fmtNum(e.amount)}</span>
        <button class="smallbtn" data-del="${e.id}">Șterge</button>
      </div>
    `;
    list.appendChild(div);
  }

  list.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-del");
      deleteNormalExpense(mk, id);
    });
  });
}

function renderPenalties() {
  const list = $("penList");
  const totalEl = $("penTotal");
  list.innerHTML = "";

  const items = (state.nextMonthPenalties || []).slice().reverse();
  const total = round2(items.reduce((a,p)=>a+n2(p.amount),0));
  totalEl.textContent = fmtRON(total);

  if (!items.length) {
    list.innerHTML = `<div class="hint">Nicio penalizare setată pentru luna viitoare.</div>`;
    return;
  }

  for (const p of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__left">
        <div class="item__title">${fmtRON(p.amount)}</div>
        <div class="item__sub">${p.note ? escapeHtml(p.note) : "—"} • ${new Date(p.at).toLocaleString("ro-RO")}</div>
      </div>
      <div class="item__right">
        <button class="smallbtn" data-delpen="${p.id}">Șterge</button>
      </div>
    `;
    list.appendChild(div);
  }

  list.querySelectorAll("button[data-delpen]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delpen");
      state.nextMonthPenalties = (state.nextMonthPenalties || []).filter(x => x.id !== id);
      saveState();
      renderAll();
    });
  });
}

function renderBig(mk) {
  const list = $("bigList");
  const totalEl = $("bigTotal");
  list.innerHTML = "";

  const m = getMonthObj(mk);
  const items = (m.bigExpenses || []).slice().reverse();
  const total = round2(items.reduce((a,b)=>a+n2(b.amount),0));
  totalEl.textContent = fmtRON(total);

  if (!items.length) {
    list.innerHTML = `<div class="hint">Nicio cheltuială mare adăugată.</div>`;
    return;
  }

  for (const b of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__left">
        <div class="item__title">${fmtRON(b.amount)}</div>
        <div class="item__sub">${b.note ? escapeHtml(b.note) : "—"} • ${new Date(b.at).toLocaleString("ro-RO")}</div>
      </div>
      <div class="item__right">
        <button class="smallbtn" data-planref="${b.id}">Rambursare</button>
        <button class="smallbtn" data-delbig="${b.id}">Șterge</button>
      </div>
    `;
    list.appendChild(div);
  }

  list.querySelectorAll("button[data-delbig]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delbig");
      const m = getMonthObj(mk);
      m.bigExpenses = (m.bigExpenses || []).filter(x => x.id !== id);
      saveState();
      renderAll();
    });
  });

  list.querySelectorAll("button[data-planref]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-planref");
      const m = getMonthObj(mk);
      const be = (m.bigExpenses || []).find(x => x.id === id);
      if (!be) return;
      addRefundPending(be.amount, `Rambursare: ${be.note || "cheltuială mare"}`);
      toast("Rambursare pusă la „în așteptare” (nu intră în sold până nu dai Încasat).");
    });
  });
}

function renderRefunds() {
  const list = $("refList");
  const totalEl = $("refTotal");
  list.innerHTML = "";

  const items = (state.refundsPending || []).slice().reverse();
  const total = round2(items.reduce((a,r)=>a+n2(r.amount),0));
  totalEl.textContent = fmtRON(total);

  // notice bar behavior
  const notice = $("noticeBar");
  const noticeText = $("noticeText");
  if (items.length > 0) {
    notice.classList.remove("hidden");
    if (items.length <= 3) {
      noticeText.textContent = items.map(x => fmtNum(x.amount)).join(" • ");
    } else {
      noticeText.textContent = `${items.length} rambursări • total ${fmtNum(total)} RON`;
    }
  } else {
    notice.classList.add("hidden");
  }

  if (!items.length) {
    list.innerHTML = `<div class="hint">Nicio rambursare în așteptare.</div>`;
    return;
  }

  for (const r of items) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__left">
        <div class="item__title">${fmtRON(r.amount)}</div>
        <div class="item__sub">${r.note ? escapeHtml(r.note) : "—"} • ${new Date(r.at).toLocaleString("ro-RO")}</div>
      </div>
      <div class="item__right">
        <button class="smallbtn" data-received="${r.id}">Încasat</button>
        <button class="smallbtn" data-edit="${r.id}">Modifică</button>
        <button class="smallbtn" data-delref="${r.id}">Șterge</button>
      </div>
    `;
    list.appendChild(div);
  }

  list.querySelectorAll("button[data-delref]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-delref");
      state.refundsPending = (state.refundsPending || []).filter(x => x.id !== id);
      saveState();
      renderAll();
    });
  });

  list.querySelectorAll("button[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const r = (state.refundsPending || []).find(x => x.id === id);
      if (!r) return;
      const newVal = prompt("Sumă nouă (RON):", String(r.amount));
      if (newVal === null) return;
      const amt = parseAmount(newVal);
      if (amt <= 0) return toast("Sumă invalidă.");
      r.amount = amt;
      saveState();
      renderAll();
    });
  });

  list.querySelectorAll("button[data-received]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-received");
      markRefundReceived(id);
    });
  });
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderArchive() {
  const box = $("archiveList");
  box.innerHTML = "";
  const months = Object.keys(state.months || {}).sort().reverse();

  for (const mk of months) {
    const sum = buildMonthSummary(mk);
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="item__left">
        <div class="item__title">${mk}</div>
        <div class="item__sub">Buget: ${fmtNum(sum.start)} • Cheltuit: ${fmtNum(sum.spentAll)} • Rămâne: ${fmtNum(sum.remain)}</div>
      </div>
      <div class="item__right">
        <button class="smallbtn" data-openm="${mk}">Detalii</button>
      </div>
    `;
    box.appendChild(div);
  }

  box.querySelectorAll("button[data-openm]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mk = btn.getAttribute("data-openm");
      alert(buildMonthDetailsText(mk));
    });
  });
}

function buildMonthSummary(mk) {
  const start = monthStartingBudget(mk);
  const big = sumBigMonth(mk);
  const refunds = sumRefundsReceivedMonth(mk);
  const normal = sumNormalMonth(mk);
  const spentAll = round2(big + normal);
  const remain = round2(start - big + refunds - normal);
  return { start, big, refunds, normal, spentAll, remain };
}

function buildMonthDetailsText(mk) {
  const m = getMonthObj(mk);
  const s = buildMonthSummary(mk);

  // grupăm cheltuielile pe zile
  const byDay = {};
  for (const e of (m.normalExpenses || [])) {
    byDay[e.dateKey] = (byDay[e.dateKey] || 0) + n2(e.amount);
  }
  const days = Object.keys(byDay).sort();

  let out = `Luna ${mk}\n` +
            `Buget start: ${fmtNum(s.start)}\n` +
            `Penalizări aplicate: ${fmtNum(n2(m.appliedPenaltySum))}\n` +
            `Cheltuieli mari: ${fmtNum(s.big)}\n` +
            `Rambursări încasate: ${fmtNum(s.refunds)}\n` +
            `Cheltuieli normale: ${fmtNum(s.normal)}\n` +
            `Rămâne: ${fmtNum(s.remain)}\n\n` +
            `Cheltuieli pe zile:\n`;

  if (!days.length) out += `—\n`;
  for (const d of days) {
    out += `${d}: ${fmtNum(byDay[d])}\n`;
  }
  return out;
}

/* Actions */
function parseAmount(str) {
  // acceptă "12,5" sau "12.5"
  const s = String(str).trim().replace(",", ".");
  const v = Number(s);
  return round2(Number.isFinite(v) ? v : 0);
}

function addNormalExpense(mk, tk, amount, note) {
  const m = getMonthObj(mk);
  m.normalExpenses.push({ id: uid(), dateKey: tk, amount: round2(amount), note: note || "", at: Date.now() });
  saveState();
}

function deleteNormalExpense(mk, id) {
  const m = getMonthObj(mk);
  m.normalExpenses = (m.normalExpenses || []).filter(e => e.id !== id);
  saveState();
  renderAll();
}

function addPenalty(amount, note) {
  state.nextMonthPenalties.push({ id: uid(), amount: round2(amount), note: note || "", at: Date.now() });
  saveState();
}

function addBigExpense(mk, amount, note) {
  const m = getMonthObj(mk);
  m.bigExpenses.push({ id: uid(), amount: round2(amount), note: note || "", at: Date.now() });
  saveState();
}

function addRefundPending(amount, note) {
  state.refundsPending.push({ id: uid(), amount: round2(amount), note: note || "", at: Date.now() });
  saveState();
}

function markRefundReceived(pendingId) {
  const now = new Date();
  const mk = monthKey(now);
  ensureMonth(mk, now);
  const m = getMonthObj(mk);

  const r = (state.refundsPending || []).find(x => x.id === pendingId);
  if (!r) return;

  const receivedStr = prompt("Cât ai încasat efectiv? (poate fi parțial)", String(r.amount));
  if (receivedStr === null) return;

  const amt = parseAmount(receivedStr);
  if (amt <= 0) return toast("Sumă invalidă.");

  m.refundsReceived.push({
    id: uid(),
    amount: amt,
    note: r.note || "",
    at: Date.now(),
    fromPendingId: r.id
  });

  // dacă a fost parțial, rămâne restul în pending
  if (amt >= n2(r.amount)) {
    state.refundsPending = (state.refundsPending || []).filter(x => x.id !== pendingId);
  } else {
    r.amount = round2(n2(r.amount) - amt);
  }

  saveState();
  renderAll();
  toast("Încasat! Suma intră în sold și îți recalculă bugetele.");
}

/* Simulation */
function simulate(now, cost, mode) {
  const dash = computeDashboard(now);
  const dLeft = dash.dLeft;

  if (dLeft <= 0) return "Nu mai sunt zile rămase în luna asta.";

  const mk = dash.mk;
  const start = dash.startBudget;
  const m = getMonthObj(mk);

  const spentBeforeToday = sumNormalBeforeToday(mk, dash.tk);
  const big = sumBigMonth(mk);
  const refunds = sumRefundsReceivedMonth(mk);

  const dayBasePool = round2(start - big + refunds - spentBeforeToday);
  const todayAllowance = round2(dayBasePool / dLeft);

  const spentToday = dash.spentToday;

  if (mode === "today") {
    const newRemainToday = round2(todayAllowance - (spentToday + cost));
    const newTomorrow = (dLeft - 1) > 0 ? round2((dayBasePool - (spentToday + cost)) / (dLeft - 1)) : 0;
    const newRemainMonth = round2((start - big + refunds) - (sumNormalMonth(mk) + cost));
    return [
      `SIM (azi normal):`,
      `Rămâne azi: ${fmtNum(newRemainToday)}`,
      `Buget mâine: ${fmtNum(newTomorrow)}`,
      `Rămâne luna: ${fmtNum(newRemainMonth)}`
    ].join("\n");
  }

  // big: cost scade din pool (afectează allowance), dar nu intră la "cheltuit azi"
  const newDayBasePool = round2(dayBasePool - cost);
  const newAllowance = round2(newDayBasePool / dLeft);
  const newRemainToday = round2(newAllowance - spentToday);
  const newTomorrow = (dLeft - 1) > 0 ? round2((newDayBasePool - spentToday) / (dLeft - 1)) : 0;

  const newRemainMonth = round2((start - (big + cost) + refunds) - sumNormalMonth(mk));

  return [
    `SIM (cheltuială mare):`,
    `Rămâne azi: ${fmtNum(newRemainToday)}`,
    `Buget mâine: ${fmtNum(newTomorrow)}`,
    `Rămâne luna: ${fmtNum(newRemainMonth)}`
  ].join("\n");
}

/* Export */
function exportTxtCurrentMonth() {
  const now = new Date();
  const mk = monthKey(now);
  ensureMonth(mk, now);

  const txt = buildMonthDetailsText(mk);
  downloadFile(`buget-${mk}.txt`, "text/plain;charset=utf-8", txt);
}
function exportJsonAll() {
  const txt = JSON.stringify(state, null, 2);
  downloadFile(`buget-backup.json`, "application/json;charset=utf-8", txt);
}
function downloadFile(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Drawer + modals */
function openDrawer(){ $("drawer").classList.remove("hidden"); }
function closeDrawer(){ $("drawer").classList.add("hidden"); }
function openArchive(){ $("modalArchive").classList.remove("hidden"); renderArchive(); }
function closeArchive(){ $("modalArchive").classList.add("hidden"); }
function openExport(){ $("modalExport").classList.remove("hidden"); }
function closeExport(){ $("modalExport").classList.add("hidden"); }

/* Render all */
function renderAll() {
  const now = new Date();
  const dash = computeDashboard(now);

  $("clockLine").textContent = `${now.toLocaleDateString("ro-RO")} • ${now.toLocaleTimeString("ro-RO")}`;
  $("spentToday").textContent = fmtRON(dash.spentToday);
  $("daysLeft").textContent = String(dash.dLeft);
  $("remainMonth").textContent = fmtRON(dash.remainMonthNow);
  $("tomorrowBudget").textContent = fmtRON(dash.tomorrow);
  $("remainToday").textContent = fmtRON(dash.remainToday);

  setHeroColor(dash.remainToday);

  // hint text
  const msg =
    dash.spentToday === 0
      ? "Perfect. Ține-o tot așa 🙂"
      : (dash.remainToday < 0 ? "Ești pe minus azi, dar mâine se redistribuie automat." : "Ești ok pe azi.");
  $("todayHint").textContent = msg;

  // footer info
  const info = `Luna: ${dash.mk} • Buget start: ${fmtNum(dash.startBudget)} • Cheltuit normal: ${fmtNum(dash.spentMonthAllNormal)} • Cheltuieli mari: ${fmtNum(dash.big)} • Rambursări încasate: ${fmtNum(dash.refundsReceived)}`;
  $("footInfo").textContent = info;

  // settings fields
  $("setIncome").value = String(state.settings.incomePerDay);
  $("setWarn").value = String(state.settings.warnThreshold);
  $("setDanger").value = String(state.settings.dangerThreshold);

  renderTodayList(dash.mk, dash.tk);
  renderPenalties();
  renderBig(dash.mk);
  renderRefunds();
}

/* Month rollover check (simplu, sigur) */
let lastTickDateKey = dateKey(new Date());
let lastTickMonthKey = monthKey(new Date());

function tickRollover() {
  const now = new Date();
  const dk = dateKey(now);
  const mk = monthKey(now);

  if (mk !== lastTickMonthKey) {
    ensureMonth(mk, now);
    toast("Lună nouă! Am arhivat automat și am aplicat penalizările.");
    lastTickMonthKey = mk;
  }

  if (dk !== lastTickDateKey) {
    lastTickDateKey = dk;
    toast("Zi nouă! Buget recalculat.");
  }

  renderAll();
}

/* Events */
function wireEvents() {
  $("btnMenu").addEventListener("click", openDrawer);
  $("btnCloseDrawer").addEventListener("click", closeDrawer);
  $("drawer").addEventListener("click", (e) => { if (e.target === $("drawer")) closeDrawer(); });

  $("goTop").addEventListener("click", () => { window.scrollTo({top:0, behavior:"smooth"}); closeDrawer(); });
  $("goRefunds").addEventListener("click", () => { $("refAmount").scrollIntoView({behavior:"smooth"}); closeDrawer(); });
  $("goArchive").addEventListener("click", () => { openArchive(); closeDrawer(); });
  $("goExport").addEventListener("click", () => { openExport(); closeDrawer(); });

  $("btnOpenArchive").addEventListener("click", openArchive);
  $("btnCloseArchive").addEventListener("click", closeArchive);
  $("modalArchive").addEventListener("click", (e)=>{ if(e.target===$("modalArchive")) closeArchive(); });

  $("btnBackup").addEventListener("click", openExport);
  $("btnCloseExport").addEventListener("click", closeExport);
  $("modalExport").addEventListener("click", (e)=>{ if(e.target===$("modalExport")) closeExport(); });

  $("btnExportTxt").addEventListener("click", exportTxtCurrentMonth);
  $("btnExportJson").addEventListener("click", exportJsonAll);

  $("btnOpenRefunds").addEventListener("click", () => {
    $("refAmount").scrollIntoView({behavior:"smooth"});
  });

  $("btnAddExpense").addEventListener("click", () => {
    const now = new Date();
    const mk = monthKey(now);
    const tk = dateKey(now);
    ensureMonth(mk, now);

    const amount = parseAmount($("inpAmount").value);
    const note = $("inpNote").value.trim();

    if (amount <= 0) return toast("Bagă o sumă validă.");
    addNormalExpense(mk, tk, amount, note);

    $("inpAmount").value = "";
    $("inpNote").value = "";
    renderAll();
  });

  $("btnClearToday").addEventListener("click", () => {
    const ok = confirm("Ștergi toate cheltuielile normale de azi?");
    if (!ok) return;
    const now = new Date();
    const mk = monthKey(now);
    const tk = dateKey(now);
    ensureMonth(mk, now);
    const m = getMonthObj(mk);
    m.normalExpenses = (m.normalExpenses || []).filter(e => e.dateKey !== tk);
    saveState();
    renderAll();
  });

  $("btnAddPenalty").addEventListener("click", () => {
    const amount = parseAmount($("penAmount").value);
    const note = $("penNote").value.trim();
    if (amount <= 0) return toast("Sumă penalizare invalidă.");
    addPenalty(amount, note);
    $("penAmount").value = "";
    $("penNote").value = "";
    renderAll();
  });

  $("btnAddBig").addEventListener("click", () => {
    const now = new Date();
    const mk = monthKey(now);
    ensureMonth(mk, now);

    const amount = parseAmount($("bigAmount").value);
    const note = $("bigNote").value.trim();
    if (amount <= 0) return toast("Sumă invalidă.");
    addBigExpense(mk, amount, note);
    $("bigAmount").value = "";
    $("bigNote").value = "";
    renderAll();
  });

  $("btnAddRefund").addEventListener("click", () => {
    const amount = parseAmount($("refAmount").value);
    const note = $("refNote").value.trim();
    if (amount <= 0) return toast("Sumă invalidă.");
    addRefundPending(amount, note);
    $("refAmount").value = "";
    $("refNote").value = "";
    renderAll();
  });

  $("btnSim").addEventListener("click", () => {
    const now = new Date();
    const cost = parseAmount($("simCost").value);
    const mode = $("simMode").value;
    if (cost <= 0) return toast("Cost invalid.");
    $("simOut").textContent = simulate(now, cost, mode);
  });

  $("btnSaveSettings").addEventListener("click", () => {
    const inc = parseAmount($("setIncome").value);
    const warn = parseAmount($("setWarn").value);
    const danger = parseAmount($("setDanger").value);

    if (inc <= 0) return toast("Venit/zi invalid.");
    state.settings.incomePerDay = inc;
    state.settings.warnThreshold = warn;
    state.settings.dangerThreshold = danger;
    saveState();
    renderAll();
    toast("Setări salvate.");
  });

  $("btnResetAll").addEventListener("click", () => {
    const ok = confirm("Reset total? Șterge TOT din aplicație.");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    saveState();
    renderAll();
    toast("Reset făcut.");
  });

  // Enter key quick add
  $("inpAmount").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("btnAddExpense").click();
  });
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

/* init */
(function init(){
  // asigură luna curentă
  const now = new Date();
  ensureMonth(monthKey(now), now);
  saveState();
  wireEvents();
  registerSW();
  renderAll();
  // tick la 30 sec, plus detect zi/lună schimbată
  setInterval(tickRollover, 30000);
  // ceas mai smooth
  setInterval(()=>{ $("clockLine").textContent = `${new Date().toLocaleDateString("ro-RO")} • ${new Date().toLocaleTimeString("ro-RO")}`; }, 1000);
})();
