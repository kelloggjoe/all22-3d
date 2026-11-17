// DOM layer: the broadcast HUD (scorebug, down and distance, play clock, timeouts), toasts and banners, the control
// legend, pass icons over the receivers, the kick meter, and a panel system (play calls, menus) that takes keyboard,
// gamepad and pointer input. Football panels live in playcall.js (ui.call); screens (title, team select, pause,
// halftime, results) in menus.js.
import { B, PAD_NAMES, cap } from "./sim/bindings.js";

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const is = (id, n, a) => (a && a.key ? (B.kb[id] || []).includes(a.key) : (B.pad[id] || []).some((i) => PAD_NAMES[i] === n));
const ORD = ["", "1ST", "2ND", "3RD", "4TH"];
const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
// focusable items by their data-i (the DOM order can differ: header buttons before the cards)
const byIndex = (root) => { const out = []; for (const b of root.querySelectorAll("[data-i]")) out[+b.dataset.i] = b; return out.filter(Boolean).length === out.length ? out : out.map((b) => b || document.createElement("i")); };
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export class UI {
  constructor(root, app) {
    this.app = app; this.root = root;
    this.hud = h("div", "hud hidden");
    this.hud.innerHTML = `
      <div class="bug" data-bug>
        <div class="tm" data-t="away"><span class="ab"></span><b class="sc"></b><span class="to"></span></div>
        <div class="tm" data-t="home"><span class="ab"></span><b class="sc"></b><span class="to"></span></div>
        <div class="gc"><span class="q"></span><span class="ck"></span></div>
        <div class="dd"></div>
        <div class="pc"></div>
      </div>
      <div class="legend" data-legend></div>
      <div class="who" data-who></div>`;
    this.icons = h("div", "icons");
    this.toastEl = h("div", "toasts");
    this.bannerEl = h("div", "banner hidden");
    this.meterEl = h("div", "meter hidden");
    this.panel = h("div", "panel hidden");
    this.layer = h("div", "layer");
    root.append(this.icons, this.hud, this.toastEl, this.bannerEl, this.meterEl, this.panel, this.layer);
    this.panelMode = null; this.screen = null;
    this.bug = {
      away: this.hud.querySelector('[data-t="away"]'), home: this.hud.querySelector('[data-t="home"]'),
      q: this.hud.querySelector(".gc .q"), ck: this.hud.querySelector(".gc .ck"), dd: this.hud.querySelector(".dd"), pc: this.hud.querySelector(".pc"),
    };
    this.legendEl = this.hud.querySelector("[data-legend]"); this.whoEl = this.hud.querySelector("[data-who]");
    this.iconEls = [];
    this.panel.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.layer.addEventListener("pointerdown", (e) => e.stopPropagation());
  }
  screenId(fallback) { return this.screen || fallback; }
  syncMute() {}
  clear() { this.layer.innerHTML = ""; this.screen = null; if (!this.panelMode) { this.pOpts = null; this.items = []; } }
  // a full screen (menus): same focus and input rules as a panel
  showScreen(id, html, o = {}) {
    this.hidePanel();
    this.layer.innerHTML = `<div class="screen ${o.cls || ""}">${html}</div>`;
    this.screen = id; this.pOpts = o;
    this.items = byIndex(this.layer);
    this.items.forEach((b) => b.addEventListener("click", () => { if (!b.disabled) { this.focusAt(+b.dataset.i); this.pick(+b.dataset.i); } }));
    this.layer.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => o.act && o.act(b.dataset.act)));
    this.sel = -1;
    this.focusAt(o.sel != null ? o.sel : 0);
  }

  // ---------- toasts and banners ----------
  toast(text, ms = 1400) {
    const t = h("div", "toast", esc(text).replace(/\{left\}/g, "◀").replace(/\{right\}/g, "▶"));
    this.toastEl.append(t);
    while (this.toastEl.children.length > 3) this.toastEl.firstChild.remove();
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
  }
  banner(title, sub = "", color = "#ffd400", ms = 2200) {
    const b = this.bannerEl;
    b.innerHTML = `<div class="slab" style="--c:${color}"><div class="bt">${esc(title)}</div>${sub ? `<div class="bs">${esc(sub)}</div>` : ""}</div>`;
    b.classList.remove("hidden"); b.classList.remove("go"); void b.offsetWidth; b.classList.add("go");
    clearTimeout(this.bannerT); this.bannerT = setTimeout(() => b.classList.add("hidden"), ms);
  }

  // ---------- HUD ----------
  showHud(on) { this.hud.classList.toggle("hidden", !on); if (!on) { this.icons.innerHTML = ""; this.iconEls = []; } }
  setTeams(w, kits) {
    for (const k of ["home", "away"]) {
      const el = this.bug[k], t = w.teams[k];
      el.style.setProperty("--c", kits[k].jersey); el.style.setProperty("--a", kits[k].accent);
      el.querySelector(".ab").textContent = t.abbr;
    }
  }
  updateHud(w, pc) {
    for (const k of ["home", "away"]) {
      const el = this.bug[k];
      el.querySelector(".sc").textContent = w.score[k];
      el.classList.toggle("pos", w.possession === k && w.phase !== "over");
      const n = w.timeouts[k], to = el.querySelector(".to");
      if (!to.firstChild) to.innerHTML = "<i></i><i></i><i></i>";
      to.querySelectorAll("i").forEach((i, j) => i.classList.toggle("on", j < n));
    }
    this.bug.q.textContent = w.ot ? "OT" : w.phase === "halftime" ? "HALF" : w.phase === "over" ? "FINAL" : ORD[Math.min(4, w.quarter)] || `${w.quarter}`;
    this.bug.ck.textContent = w.phase === "over" ? "" : fmtClock(w.clock);
    let dd = "";
    if (w.playType === "kickoff") dd = "KICKOFF";
    else if (w.playType === "pat") dd = "EXTRA POINT";
    else if (w.playType === "two") dd = "2-PT TRY";
    else if (w.phase !== "over") {
      const goal = w.los + w.toGo >= 100;
      const spot = w.los < 50 ? `${w.teams[w.possession].abbr} ${Math.round(w.los)}` : w.los > 50 ? `${w.teams[w.possession === "home" ? "away" : "home"].abbr} ${Math.round(100 - w.los)}` : "50";
      dd = `${ORD[w.down] || ""} & ${goal ? "GOAL" : Math.max(1, Math.round(w.toGo))} · ${spot}`;
    }
    this.bug.dd.textContent = dd;
    const show = pc && pc.on && pc.t != null;
    this.bug.pc.textContent = show ? `:${String(Math.max(0, Math.ceil(pc.t))).padStart(2, "0")}` : "";
    this.bug.pc.classList.toggle("warn", Boolean(show && pc.t <= 5));
  }
  legend(binds, who) {
    const key = binds.map((b) => `${b.cap}|${b.label}`).join(",") + "#" + who;
    if (key === this.legendKey) return;
    this.legendKey = key;
    this.legendEl.innerHTML = binds.filter((b) => b.cap).map((b) => `<span><kbd>${esc(b.cap).replace(/\{left\}/g, "◀").replace(/\{right\}/g, "▶")}</kbd>${esc(b.label).replace(/\{left\}/g, "◀").replace(/\{right\}/g, "▶")}</span>`).join("");
    this.whoEl.innerHTML = who || "";
  }
  // pass icons: [{k, x, y, state: open|mid|cov}] in CSS px
  setIcons(list) {
    while (this.iconEls.length < list.length) { const e = h("div", "pi"); this.icons.append(e); this.iconEls.push(e); }
    this.iconEls.forEach((e, i) => {
      const it = list[i];
      if (!it) { e.style.display = "none"; return; }
      e.style.display = "";
      e.style.transform = `translate(${Math.round(it.x)}px, ${Math.round(it.y)}px)`;
      if (e.dataset.k !== String(it.label)) { e.dataset.k = String(it.label); e.textContent = it.label; }
      e.className = `pi ${it.state}`;
    });
  }
  // ---------- kick meter ----------
  meter(info) {
    const m = this.meterEl;
    if (!info) { m.classList.add("hidden"); return; }
    m.classList.remove("hidden");
    if (!m.firstChild) m.innerHTML = `<div class="mk"></div><div class="mbar"><div class="mpow"></div><div class="mgood"></div><div class="mline"></div><div class="macc"></div></div><div class="mst"></div><div class="mwind"></div>`;
    m.querySelector(".mk").textContent = info.kind || "";
    m.querySelector(".mst").textContent = info.label || info.stage || "";
    m.querySelector(".mwind").textContent = info.wind ? `WIND ${info.wind.replace("{left}", "◀").replace("{right}", "▶")}` : "";
    m.querySelector(".mpow").style.width = `${Math.round((info.power || 0) * 100)}%`;
    const g = info.good; // the green window, 0..1 across the bar
    const gw = m.querySelector(".mgood");
    if (g) { gw.style.display = ""; gw.style.left = `${(g[0] * 100).toFixed(1)}%`; gw.style.width = `${((g[1] - g[0]) * 100).toFixed(1)}%`; } else gw.style.display = "none";
    const pl = m.querySelector(".mline");
    if (info.need != null) { pl.style.display = ""; pl.style.left = `${(info.need * 100).toFixed(1)}%`; } else pl.style.display = "none";
    const ac = m.querySelector(".macc");
    if (info.acc != null) { ac.style.display = ""; ac.style.left = `${((info.acc + 1) / 2 * 100).toFixed(1)}%`; } else ac.style.display = "none";
    m.classList.toggle("perfect", Boolean(info.perfect));
  }

  // ---------- panels (bottom sheet) ----------
  showPanel(mode, html, o = {}) {
    const p = this.panel;
    p.className = `panel ${o.cls || ""}`;
    p.innerHTML = html;
    this.panelMode = mode; this.pOpts = o;
    this.items = byIndex(p);
    this.items.forEach((b) => b.addEventListener("click", () => { if (!b.disabled) this.pick(+b.dataset.i); }));
    p.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => o.act && o.act(b.dataset.act)));
    this.sel = -1;
    this.focusAt(o.sel != null ? o.sel : 0);
  }
  hidePanel() {
    const w = this.app.world;
    if (this.panelMode === "coin" && w) w.coinHold = false;
    const had = Boolean(this.panelMode);
    this.panel.className = "panel hidden"; this.panel.innerHTML = ""; this.panelMode = null;
    if (had && !this.screen) { this.items = []; this.pOpts = null; }
  }
  focusAt(i) {
    const items = this.items || [];
    if (!items.length) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    if (this.sel >= 0 && items[this.sel]) items[this.sel].classList.remove("focus");
    this.sel = i; items[i].classList.add("focus");
    if (this.pOpts && this.pOpts.onFocus) this.pOpts.onFocus(i);
    items[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  pick(i) { const o = this.pOpts; if (o && o.onPick) o.onPick(i, this.items[i]); }
  // move focus to the nearest item in a direction (by on-screen boxes: works for rows, grids and tabs)
  move(dx, dy) {
    const items = this.items || [];
    if (!items.length) return;
    const cur = items[this.sel] || items[0], r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = -1, bd = 1e9;
    items.forEach((b, i) => {
      if (i === this.sel || b.disabled && !b.dataset.tab) return;
      const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ddx = x - cx, ddy = y - cy;
      if (dx && Math.sign(ddx) !== dx) return;
      if (dy && Math.sign(ddy) !== dy) return;
      if (dx && Math.abs(ddy) > Math.max(r.height, r0.height) * 0.6) return;
      const d = dx ? Math.abs(ddx) + Math.abs(ddy) * 3 : Math.abs(ddy) + Math.abs(ddx) * 0.5;
      if (dy && Math.abs(ddy) < 4) return;
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { this.focusAt(best); this.app.audio.sfx("blip"); }
  }
  // every input while a panel or a screen is open; true = used
  handle(n, a) {
    const open = this.panelMode || this.screen;
    if (!open) return false;
    const o = this.pOpts || {};
    if (n === "mute" || n === "padConnected" || n === "padDisconnected") return false;
    if (a && a.repeat && !/^nav/.test(n)) return true;
    // a panel's own keys first (coach's pick, flip, …)
    if (o.keys) for (const [id, fn] of o.keys) if (is(id, n, a)) { fn(); return true; }
    if (n === "navLeft") { this.move(-1, 0); return true; }
    if (n === "navRight") { this.move(1, 0); return true; }
    if (n === "navUp") { this.move(0, -1); return true; }
    if (n === "navDown") { this.move(0, 1); return true; }
    if ((n === "digit" || n === "passPress") && a.d) {
      const b = (this.items || []).find((x) => x.dataset.k === String(a.d) && !x.disabled);
      if (b) { this.focusAt(+b.dataset.i); this.pick(+b.dataset.i); }
      return true;
    }
    if (n === "pass" || n === "hUp" || n === "padUp") return true;
    if (n === "enter" || n === "space" || n === B.ok) { if (this.sel >= 0 && this.items[this.sel] && !this.items[this.sel].disabled) this.pick(this.sel); return true; }
    if (n === "back" || n === B.back || (n === "pause" && o.back)) { if (o.back) { o.back(); return true; } return n !== "pause"; }
    if (n === "pause") return false;
    return true;
  }
}
