/*
 * Total Home Energy Flow Card
 * Live energy flow of the whole home: solar, grid, battery and any number of devices.
 * Line thickness follows power; optional moving dots.
 * https://github.com/gjvdveen/total-home-energy-flow-card  — MIT License
 */
const THEF_VERSION = "1.8.9";

const T = {
  en: { home_total: "Home total", produced: "produced", used: "used", imported: "imported", exp_short: "export", today_total: "Total today", home: "Home", solar: "Solar", grid: "Grid", battery: "Battery", import: "import", export: "export",
        charging: "charging", discharging: "discharging", supplying: "supplying", idle: "idle", off: "off", rest: "Other", unavailable: "unavailable", legend: "Legend", charts: "Charts", gas: "Gas", water: "Water", today: "today", price: "Price", consumption: "Usage", soc: "Battery", nodata: "No data", ring: "Ring: where the home's power comes from", lines: "Line thickness = power · dots show direction", consumers: "Devices", devices_n: "devices", now: "now", at: "at", today_tab: "Today", now_tab: "Now", price_legend: "Price (on the grid tile): dot green = cheap · orange = average · red = expensive compared with today · arrow = next price goes up or down" },
  nl: { home_total: "Huis totaal", produced: "opbrengst", used: "verbruik", imported: "afname", exp_short: "terug", today_total: "Totaal vandaag", home: "Huis", solar: "Solar", grid: "Net", battery: "Accu", import: "afname", export: "teruglevering",
        charging: "laden", discharging: "ontladen", supplying: "levert", idle: "rust", off: "uit", rest: "Overig", unavailable: "niet beschikbaar", legend: "Legenda", charts: "Grafieken", gas: "Gas", water: "Water", today: "vandaag", price: "Prijs", consumption: "Verbruik", soc: "Accu", nodata: "Geen gegevens", ring: "Ring: waar de stroom van het huis vandaan komt", lines: "Dikte van de lijn = vermogen · bolletjes = richting", consumers: "Apparaten", devices_n: "apparaten", now: "nu", at: "om", today_tab: "Vandaag", now_tab: "Nu", price_legend: "Prijs (bij Net): bolletje groen = goedkoop · oranje = gemiddeld · rood = duur t.o.v. vandaag · pijltje = volgende prijs hoger of lager" },
};

const DEFAULT_COLORS = { solar: "#ffb300", grid: "#ff6b5e", grid_export: "#00c7be", battery: "#34c759", home: "#5ac8fa", device: "#bf5af2", rest: "#8e8e93" };
const DEFAULT_ICONS = { solar: "mdi:solar-power-variant", grid: "mdi:transmission-tower", battery: "mdi:home-battery", home: "mdi:home", device: "mdi:power-plug", rest: "mdi:dots-horizontal-circle-outline" };

class TotalHomeEnergyFlowCard extends HTMLElement {
  static getStubConfig() {
    return { sources: { solar: { entity: "" }, grid: { entity: "" } }, devices: [] };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    const c = JSON.parse(JSON.stringify(config));
    c.sources = c.sources || {};
    c.devices = Array.isArray(c.devices) ? c.devices : [];
    c.max_power = Number(c.max_power) > 0 ? Number(c.max_power) : 8000;
    c.min_power = Number(c.min_power) >= 0 ? Number(c.min_power) : 10;
    c.kw_from = Number(c.kw_from) > 0 ? Number(c.kw_from) : 1000;
    c.animation = c.animation === "dots" ? "dots" : "none";
    c.lines = c.lines === "orthogonal" ? "orthogonal" : "curved";
    c.style = c.style === "filled" ? "filled" : "outlined";
    c.max_energy = Number(c.max_energy) > 0 ? Number(c.max_energy) : 30;
    c.show_rest = c.show_rest !== false;
    c.max_devices_right = Number(c.max_devices_right ?? (c.max_devices != null ? c.max_devices : 6));
    c.max_devices_left = Number(c.max_devices_left ?? 4);
    this._config = c;
    this._sig = null;
    if (!this.shadowRoot) this._build();
    if (this._hass) this._render();
  }

  getCardSize() { return 5; }
  getGridOptions() { return { columns: "full", rows: "auto", min_columns: 6 }; }

  set hass(h) { this._hass = h; this._render(); }

  // ---------- helpers ----------
  _t(k) {
    const lang = (this._config.language || (this._hass && this._hass.language) || "en").slice(0, 2);
    return (T[lang] || T.en)[k] || T.en[k] || k;
  }
  _num(entity, attr) {
    if (!entity || !this._hass) return null;
    const s = this._hass.states[entity];
    if (!s) return null;
    const raw = attr ? s.attributes[attr] : s.state;
    const n = parseFloat(raw);
    if (isNaN(n)) return null;
    const unit = (!attr && s.attributes.unit_of_measurement) || "";
    return unit === "kW" ? n * 1000 : unit === "MW" ? n * 1e6 : n;
  }
  _fmt(w) {
    if (w == null) return "–";
    if (this._mode === "today") { const loc = this._hass?.language || "en", k = w / 1000;
      return k.toLocaleString(loc, { minimumFractionDigits: Math.abs(k) < 10 ? 2 : 1, maximumFractionDigits: Math.abs(k) < 10 ? 2 : 1 }) + " kWh"; }
    const a = Math.abs(w), loc = (this._hass && this._hass.locale && this._hass.locale.language) || this._hass?.language || "en";
    if (a >= this._config.kw_from) return (w / 1000).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kW";
    return Math.round(w).toLocaleString(loc) + " W";
  }
  _width(w) {
    const mx = this._mode === "today" ? this._config.max_energy * 1000 : this._config.max_power;
    const p = Math.min(Math.abs(w || 0), mx) / mx;
    return 2 + 6 * Math.sqrt(p);
  }

  // ---------- model ----------
  _hasEnergy() {
    const c = this._config, s = c.sources;
    return !!((s.solar && (s.solar.energy || s.solar.energies)) || (s.grid && s.grid.energy_import) || (s.battery && s.battery.energy_charge) || c.devices.some((d) => d.energy));
  }
  _stat(id) {   // today's change of a total meter, in Wh
    if (!id) return null;
    this._stats = this._stats || {};
    const c0 = this._stats[id];
    if (!c0 || Date.now() - c0.t > 300000) {
      this._stats[id] = { t: Date.now(), v: c0 ? c0.v : null };
      this._hass.callWS({ type: "recorder/statistic_during_period", statistic_id: id, calendar: { period: "day" }, types: ["change"], units: { energy: "Wh" } })
        .then((r) => { this._stats[id].v = r.change; this._sig = null; this._render(); }).catch(() => {});
    }
    return this._stats[id].v;
  }
  _modelToday() {
    const c = this._config, s = c.sources, st = (id) => this._stat(id);
    const solar = s.solar ? [].concat(s.solar.energies || s.solar.energy || []).reduce((a, id) => a + (st(id) || 0), 0) : null;
    const imp = s.grid ? st(s.grid.energy_import) || 0 : 0, exp = s.grid ? st(s.grid.energy_export) || 0 : 0;
    const chg = s.battery ? st(s.battery.energy_charge) || 0 : 0, dis = s.battery ? st(s.battery.energy_discharge) || 0 : 0;
    const grid = s.grid ? imp - exp : null, batt = s.battery ? dis - chg : null;
    const soc = s.battery ? this._num(s.battery.soc) : null;
    let home = c.home && c.home.energy ? st(c.home.energy) : null;
    if (home == null) home = Math.max(0, (solar || 0) + imp - exp + dis - chg);
    const devices = c.devices.map((d, i) => { let v = d.energy ? st(d.energy) : null;
      if (v != null && d.energy_return) v -= st(d.energy_return) || 0;
      return { key: "d" + i, cfg: d, power: v }; });
    const sumDev = devices.reduce((a, d) => a + Math.max(0, d.power || 0), 0);
    const rest = Math.max(0, home - sumDev);
    let need = home; const mix = [];
    const take = (k, v) => { const t = Math.max(0, Math.min(need, v || 0)); if (t > 0) { mix.push([k, t]); need -= t; } };
    take("solar", solar); take("battery", dis); take("grid", imp);
    return { solar, grid, batt, soc, home, devices, rest, mix, imp, exp, chg, dis, energy: true };
  }

  _model() {
    if (this._mode === "today") return this._modelToday();
    const c = this._config, s = c.sources;
    const sign = (v, inv) => (v == null ? null : inv ? -v : v);
    const solarIds = s.solar ? [].concat(s.solar.entities || s.solar.entity || []) : [];
    const solar = s.solar ? Math.max(0, solarIds.reduce((a, id) => a + (this._num(id) || 0), 0)) : null;
    let grid = null;
    if (s.grid) {
      if (s.grid.entity) grid = sign(this._num(s.grid.entity), s.grid.invert);
      else if (s.grid.import || s.grid.export) grid = (this._num(s.grid.import) || 0) - (this._num(s.grid.export) || 0);
    }
    let batt = null, soc = null;   // batt: + = discharging into the home, - = charging
    if (s.battery) {
      if (s.battery.entity) batt = sign(this._num(s.battery.entity), s.battery.invert);   // default: + discharge
      else if (s.battery.charge || s.battery.discharge) batt = (this._num(s.battery.discharge) || 0) - (this._num(s.battery.charge) || 0);
      soc = this._num(s.battery.soc);
    }
    let home = c.home && c.home.entity ? this._num(c.home.entity) : null;
    if (home == null) home = Math.max(0, (solar || 0) + (grid || 0) + (batt || 0));
    const devices = c.devices.map((d, i) => {
      const p = this._num(d.entity);
      let v = p == null ? null : (d.invert ? -p : p);
      if (v != null && !d.bidirectional) v = Math.max(0, v);
      return { key: "d" + i, cfg: d, power: v };
    });
    const sumDev = devices.reduce((a, d) => a + Math.max(0, d.power || 0), 0);
    const rest = Math.max(0, home - sumDev);
    // where does the home's power come from (solar first, then battery, then grid, then devices that supply)
    let need = home; const mix = [];
    const take = (k, v) => { const t = Math.max(0, Math.min(need, v || 0)); if (t > 0) { mix.push([k, t]); need -= t; } };
    take("solar", solar); take("battery", batt); take("grid", grid);
    devices.forEach((d) => { if ((d.power || 0) < 0) take(d.key, -d.power); });
    return { solar, grid, batt, soc, home, devices, rest, mix };
  }

  // ---------- DOM ----------
  _build() {
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = `
      <style>
        :host { display:block; }
        .card { position:relative; border-radius: var(--ha-card-border-radius, 22px); padding:14px; box-sizing:border-box;
          --thef-bg: var(--ha-card-background, var(--card-background-color, #1c1c1e)); background: var(--thef-bg);
          --thef-in: color-mix(in srgb, var(--thef-bg) 86%, #8e8e93); color: var(--primary-text-color); overflow:hidden; }
        .head { display:flex; align-items:center; gap:10px; margin:0 2px 10px; min-height:0; } .head:has(.title:empty):has(.pchip[hidden]):has(.seg[hidden]) { display:none; }
        .title { font-size:16px; font-weight:600; flex:1; min-width:0; }
        .seg { display:flex; padding:2px; border-radius:12px; background: rgba(127,127,127,.16); font-size:12px; font-weight:600; flex:0 0 auto; }
        .seg span { padding:4px 10px; border-radius:10px; cursor:pointer; opacity:.7; user-select:none; }
        .seg span.sel { background: var(--thef-in, rgba(127,127,127,.3)); opacity:1; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
        .pchip { display:flex; align-items:center; gap:6px; padding:4px 9px 4px 5px; border-radius:16px; background: rgba(127,127,127,.14); cursor:pointer; white-space:nowrap; }
        .pchip .dot { width:18px; height:18px; border-radius:50%; background: var(--pc); display:flex; align-items:center; justify-content:center; }
        .pchip .dot ha-icon { --mdc-icon-size:12px; color:#fff; }
        .pchip .pv { font-size:13px; font-weight:700; font-variant-numeric: tabular-nums; }
        .pchip .pn { font-size:10.5px; opacity:.7; }
        .grid { position:relative; display:grid; grid-template-columns: minmax(0,.8fr) minmax(0,.9fr) minmax(0,.8fr); grid-template-rows: auto auto auto;
          column-gap: 15%; row-gap: 56px; align-items:center; }
        .left { grid-column:1; grid-row:1 / 4; } .right { grid-column:3; grid-row:1 / 4; }
        .top { grid-column:2; grid-row:1; } .mid { grid-column:2; grid-row:2; } .bottom { grid-column:2; grid-row:3; }
        .top .node, .bottom .node { width:100%; box-sizing:border-box; }
        .col { display:flex; flex-direction:column; gap:10px; position:relative; z-index:1; }
        .mid { justify-content:center; align-items:center; }
        .node { display:flex; flex-direction:column; align-items:flex-start; gap:2px; padding:8px 11px; border-radius:14px; cursor:pointer; min-width:0;
          background: rgba(127,127,127,.14); border:1.5px solid transparent; transition: background .3s, border-color .3s; -webkit-tap-highlight-color: transparent; }
        .node.on { background: color-mix(in srgb, var(--c) 22%, transparent); border-color: color-mix(in srgb, var(--c) 55%, transparent); }
        .outlined .node:not(.home) { background: rgba(127,127,127,.05); border-color: rgba(127,127,127,.32); }
        .outlined .node.on:not(.home) { background: color-mix(in srgb, var(--c) 10%, transparent); border-color: var(--c); }
        .hd { display:flex; align-items:center; gap:6px; min-width:0; max-width:100%; }
        .vr { display:flex; align-items:center; gap:5px; } .vi { display:none; }
        .pr { display:flex; align-items:center; gap:4px; font-size:11.5px; opacity:.85; margin-top:1px; font-variant-numeric: tabular-nums; white-space:nowrap; }
        .pr i { width:7px; height:7px; border-radius:50%; background: var(--pc); flex:0 0 auto; }
        .pr ha-icon { --mdc-icon-size:13px !important; opacity:.75; color: inherit !important; display:inline-flex !important; }
        .node ha-icon { --mdc-icon-size:18px; color: var(--secondary-text-color); flex:0 0 auto; }
        .node.on ha-icon { color: var(--c); }
        .n { font-size:13px; font-weight:500; opacity:.85; line-height:1.2; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; word-break:normal; overflow-wrap:normal; hyphens:manual; }
        .v { font-size:16px; font-weight:600; white-space:nowrap; font-variant-numeric: tabular-nums; line-height:1.25; min-width:0; overflow:hidden; text-overflow:ellipsis; }
        [hidden] { display:none !important; }
        .v .u { font-size:.72em; font-weight:500; opacity:.75; }
        .vr { min-width:0; max-width:100%; }
        .s { font-size:12px; opacity:.7; line-height:1.2; overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
        .mid { align-items:center; }
        .node.home { width:min(100%, 118px); aspect-ratio:1; border-radius:50%; padding:0; justify-content:center; align-items:center; text-align:center; gap:0;
          border:none; background: radial-gradient(closest-side, var(--thef-in) calc(100% - 4px), transparent calc(100% - 3.5px)), var(--mix, rgba(127,127,127,.3)); }
        .node.home.on { background: radial-gradient(closest-side, var(--thef-in) calc(100% - 4px), transparent calc(100% - 3.5px)), var(--mix, rgba(127,127,127,.3)); border:none; }
        .home .hd { flex-direction:column; gap:2px; }
        .home ha-icon { --mdc-icon-size:24px; color: var(--primary-text-color) !important; opacity:.85; }
        .home .n { font-size:12px; opacity:.7; }
        .home .v { font-size:18px; }
        .right .node { padding:8px 11px; }
        .right .v { font-size:15px; }
        .extra { display:flex; gap:8px; margin-top:14px; } .extra:empty { display:none; }
        .xt { flex:1; display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:14px; background: rgba(127,127,127,.14); min-width:0; cursor:pointer; }
        .xt ha-icon { --mdc-icon-size:18px; color: var(--c); } .xt .v { font-size:14px; } .xt .s { font-size:11px; }
        .charts { margin-top:14px; }
        .chead { font-size:12px; opacity:.7; font-weight:500; cursor:pointer; user-select:none; margin-bottom:8px; }
        .chead::before { content:"▸ "; } .charts.open .chead::before { content:"▾ "; }
        .charts:not(.open) .cbody { display:none; } .charts:not(.open) .chead { margin-bottom:0; }
        .tabs { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; }
        .tab { padding:5px 12px; border-radius:14px; font-size:12.5px; font-weight:600; background: rgba(127,127,127,.16); cursor:pointer; user-select:none; }
        .tab.sel { background: var(--primary-color, #03a9f4); color:#fff; }
        .chart { position:relative; height:140px; } .chart svg { width:100%; height:100%; display:block; overflow:visible; }
        .chart .leeg { font-size:12px; opacity:.6; padding-top:50px; text-align:center; }
        .legend { margin-top:12px; font-size:12px; } .legend summary { cursor:pointer; opacity:.7; font-weight:500; list-style:none; }
        .legend summary::before { content:"▸ "; } .legend[open] summary::before { content:"▾ "; }
        .lg { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px; opacity:.85; }
        .lg span { display:inline-flex; align-items:center; gap:5px; } .lg i { width:10px; height:10px; border-radius:50%; display:inline-block; }
        .lg .w { flex-basis:100%; }
        svg.lines { position:absolute; inset:0; width:100%; height:100%; z-index:0; overflow:visible; pointer-events:none; }
        @media (prefers-reduced-motion: reduce) { .dot { display:none; } }
        @container (max-width: 460px) { .grid { column-gap:12%; row-gap:48px; grid-template-columns: minmax(0,.82fr) minmax(0,.95fr) minmax(0,.82fr); }
          .node { padding:6px 8px; border-radius:12px; gap:1px; } .right .node { padding:6px 8px; } .col { gap:7px; }
          .node ha-icon { --mdc-icon-size:15px; } .hd { gap:4px; }
          .left .node ha-icon, .right .node ha-icon { display:none !important; }
          .n { font-size:11px; } .v, .right .v { font-size:14px; } .s { font-size:10.5px; }
          .node.home { width:min(100%, 96px); } .home ha-icon { --mdc-icon-size:20px; } .home .v { font-size:15px; } .home .n { font-size:11px; } }
      </style>
      <div class="card" style="container-type:inline-size">
        <div class="head"><div class="title"></div><div class="pchip" hidden></div><div class="seg" hidden><span data-m="now"></span><span data-m="today"></span></div></div>
        <div class="grid">
          <svg class="lines"></svg>
          <div class="col left"></div>
          <div class="col top"></div>
          <div class="col mid"></div>
          <div class="col bottom"></div>
          <div class="col right"></div>
        </div>
        <div class="extra"></div>
        <div class="charts" hidden><div class="chead"></div><div class="cbody"><div class="tabs"></div><div class="chart"></div></div></div>
        <details class="legend" hidden><summary></summary><div class="lg"></div></details>
      </div>`;
    this._el = { title: r.querySelector(".title"), grid: r.querySelector(".grid"), svg: r.querySelector("svg.lines"),
      pchip: r.querySelector(".pchip"), seg: r.querySelector(".seg"),
      left: r.querySelector(".left"), top: r.querySelector(".top"), mid: r.querySelector(".mid"), bottom: r.querySelector(".bottom"), right: r.querySelector(".right"),
      extra: r.querySelector(".extra"), charts: r.querySelector(".charts"), tabs: r.querySelector(".tabs"), chart: r.querySelector(".chart"),
      legend: r.querySelector(".legend"), lg: r.querySelector(".lg") };
    this._el.charts.querySelector(".chead").addEventListener("click", () => {
      this._chOpen = !this._chOpen; try { localStorage.setItem("thef-charts-open", this._chOpen ? "1" : "0"); } catch (_) {}
      this._el.charts.classList.toggle("open", this._chOpen); if (this._chOpen) { this._chartSig = null; this._renderChart(true); } });
    this._el.seg.addEventListener("click", (e) => { const b = e.target.closest("[data-m]"); if (!b) return;
      this._mode = b.dataset.m; try { localStorage.setItem("thef-mode", this._mode); } catch (_) {} this._sig = null; this._render(); });
    this._el.tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; this._tab = b.dataset.tab; this._chartSig = null; this._renderChart(true); });
    this._ro = new ResizeObserver(() => this._drawLines());
    this._ro.observe(this._el.grid);
  }

  _node(key, { name, icon, color, value, sub, on, entity, navigate, cls }) {
    let n = this._nodes[key];
    if (!n) {
      n = document.createElement("div");
      n.className = "node " + (cls || "");
      n.innerHTML = `<div class="hd"><ha-icon></ha-icon><div class="n"></div></div><div class="vr"><ha-icon class="vi"></ha-icon><div class="v"></div></div><div class="s"></div>`;
      n.addEventListener("click", () => {
        const nav = n._navigate, ent = n._entity;
        if (nav) { history.pushState(null, "", nav); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); }
        else if (ent) this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: ent }, bubbles: true, composed: true }));
      });
      this._nodes[key] = n;
    }
    n._entity = entity; n._navigate = navigate;
    n.style.setProperty("--c", color);
    n.classList.toggle("on", !!on);
    n.querySelectorAll(".hd ha-icon, .vi").forEach((ic) => { if (ic.getAttribute("icon") !== icon) ic.setAttribute("icon", icon); });
    const set = (sel, t) => { const e = n.querySelector(sel); t = t == null ? "" : String(t); if (e.textContent !== t) e.textContent = t; e.hidden = !t; };
    set(".n", name); set(".s", sub);
    { const e = n.querySelector(".v"), t = value == null ? "" : String(value), mm = t.match(/^(.*\S)\s(kWh|kW|W|Wh|MWh)$/);
      if (e._t !== t) { e._t = t; e.hidden = !t; e.textContent = mm ? mm[1] : t;
        if (mm) { const u = document.createElement("span"); u.className = "u"; u.textContent = "\u00a0" + mm[2]; e.appendChild(u); } } }
    return n;
  }

  _render() {
    if (!this._hass || !this._config || !this._el) return;
    if (this._mode == null) { let v = null; try { v = localStorage.getItem("thef-mode"); } catch (_) {} this._mode = v === "today" && this._hasEnergy() ? "today" : (this._config.mode === "today" && this._hasEnergy() ? "today" : "now"); }
    if (this._mode === "today" && !this._hasEnergy()) this._mode = "now";
    const c = this._config, s = c.sources, m = this._model();
    const sig = JSON.stringify([m, c.title, this._mode]);
    if (sig === this._sig) return;
    this._sig = sig;
    this._nodes = this._nodes || {};
    this._flows = [];
    const minP = c.min_power;
    const col = (k, cfg) => (cfg && cfg.color) || DEFAULT_COLORS[k];
    const ico = (k, cfg) => (cfg && cfg.icon) || DEFAULT_ICONS[k];

    const t = this._el.title; if (t.textContent !== (c.title || "")) t.textContent = c.title || "";
    this.shadowRoot.querySelector(".card").classList.toggle("outlined", c.style === "outlined");
    this.shadowRoot.querySelector(".card").classList.toggle("today", this._mode === "today");
    const sg = this._el.seg; sg.hidden = !this._hasEnergy() || c.show_toggle === false;
    if (!sg.hidden) { sg.children[0].textContent = this._t("now_tab"); sg.children[1].textContent = this._t("today_tab");
      [...sg.children].forEach((x) => x.classList.toggle("sel", x.dataset.m === (this._mode || "now"))); }
    this._renderPrice();

    // left: sources
    const left = [];
    if (s.solar) {
      const on = m.solar > minP;
      left.push(this._node("solar", { name: s.solar.name || this._t("solar"), icon: ico("solar", s.solar), color: col("solar", s.solar),
        value: this._fmt(m.solar), on, entity: [].concat(s.solar.entities || s.solar.entity || [])[0], navigate: s.solar.navigate }));
      this._flows.push({ from: "solar", to: "home", p: m.solar, color: col("solar", s.solar) });
    }
    const top = [], bottom = [];
    if (s.grid) {
      const imp = (m.grid || 0) > minP, exp = (m.grid || 0) < -minP;
      const color = exp ? (s.grid.export_color || DEFAULT_COLORS.grid_export) : col("grid", s.grid);
      top.push(this._node("grid", { name: s.grid.name || this._t("grid"), icon: ico("grid", s.grid), color,
        value: m.energy ? this._fmt(m.imp) : this._fmt(m.grid == null ? null : Math.abs(m.grid)),
        sub: m.energy ? this._t("export") + " " + this._fmt(m.exp) : imp ? this._t("import") : exp ? this._t("export") : "",
        on: imp || exp, entity: s.grid.entity || s.grid.import, navigate: s.grid.navigate }));
      this._flows.push({ from: "grid", to: "home", p: m.grid, color, dir: "v" });
      const gn = this._nodes.grid, pi = this._priceInfo;
      let pr = gn.querySelector(".pr");
      if (pi) {
        if (!pr) { pr = document.createElement("div"); pr.className = "pr"; pr.innerHTML = `<i></i><span></span><ha-icon></ha-icon>`; gn.appendChild(pr); }
        pr.style.setProperty("--pc", pi.color);
        if (pr.children[1].textContent !== pi.text) pr.children[1].textContent = pi.text;
        const ti = pr.querySelector("ha-icon"); ti.hidden = !pi.trend; if (pi.trend && ti.getAttribute("icon") !== pi.trend) ti.setAttribute("icon", pi.trend);
        pr.title = pi.title;
      } else if (pr) pr.remove();
    }
    if (s.battery) {
      const dis = (m.batt || 0) > minP, chg = (m.batt || 0) < -minP;
      const lowSoc = s.battery.soc_alarm != null && m.soc != null && m.soc < s.battery.soc_alarm;
      const color = lowSoc ? "#ff6b5e" : col("battery", s.battery);
      const soc = m.soc != null ? Math.round(m.soc) + "%" : "";
      bottom.push(this._node("battery", { name: s.battery.name || this._t("battery"),
        icon: ico("battery", s.battery), color, value: m.energy ? this._fmt(m.chg) : this._fmt(m.batt == null ? null : Math.abs(m.batt)),
        sub: m.energy ? this._t("discharging") + " " + this._fmt(m.dis) + (soc ? " · " + soc : "")
          : (soc ? soc + " · " : "") + (dis ? this._t("discharging") : chg ? this._t("charging") : this._t("idle")), on: dis || chg || lowSoc,
        entity: s.battery.soc || s.battery.entity || s.battery.discharge, navigate: s.battery.navigate }));
      this._flows.push({ from: "battery", to: "home", p: m.batt, color, dir: "v" });
    }
    this._place(this._el.top, top);
    this._place(this._el.bottom, bottom);

    // middle: home
    const hc = c.home || {};
    const homeNode = this._node("home", { name: hc.name || this._t("home"), icon: ico("home", hc), color: col("home", hc),
      value: this._fmt(m.home), on: m.home > minP, entity: hc.entity, navigate: hc.navigate, cls: "home" });
    const tot = m.mix.reduce((a, x) => a + x[1], 0);
    if (tot > 0) {
      const colorOf = (k) => k === "solar" ? col("solar", s.solar) : k === "battery" ? col("battery", s.battery) : k === "grid" ? col("grid", s.grid)
        : ((c.devices[+k.slice(1)] || {}).color || DEFAULT_COLORS.device);
      let a = 0; const stops = m.mix.map(([k, v]) => { const b = a + v / tot * 360, st = `${colorOf(k)} ${a.toFixed(1)}deg ${b.toFixed(1)}deg`; a = b; return st; });
      homeNode.style.setProperty("--mix", `conic-gradient(${stops.join(", ")})`);
    } else homeNode.style.removeProperty("--mix");
    this._place(this._el.mid, [homeNode]);

    // devices: right (default) or left (side: left); sort / max per side, overflow counts in "Other"
    const right = [];
    const cand = { left: [], right: [] };
    m.devices.forEach((d) => {
      const cfg = d.cfg, thr = cfg.min_power != null ? cfg.min_power : minP;
      const use = (d.power || 0) > thr, give = (d.power || 0) < -thr, on = use || give;
      if (cfg.hide_when_off && !on) return;
      cand[cfg.side === "left" ? "left" : "right"].push({ d, on, use, give });
    });
    let restExtra = 0, restCount = 0;
    for (const side of ["left", "right"]) {
      let list = cand[side];
      if (c.sort === "power") list = list.slice().sort((x, y) => Math.abs(y.d.power || 0) - Math.abs(x.d.power || 0));
      const max = side === "left" ? Math.max(0, c.max_devices_left - left.length) : c.max_devices_right - (c.show_rest ? 1 : 0);
      if (list.length > max) {
        // keep the biggest consumers visible, keep configured order among them
        const keep = new Set(list.slice().sort((x, y) => Math.abs(y.d.power || 0) - Math.abs(x.d.power || 0)).slice(0, Math.max(0, max)));
        list.filter((x) => !keep.has(x)).forEach((x) => { restExtra += Math.max(0, x.d.power || 0); restCount++; });
        list = list.filter((x) => keep.has(x));
      }
      list.forEach(({ d, on, give }) => {
        const cfg = d.cfg, color = cfg.color || DEFAULT_COLORS.device;
        const subE = cfg.secondary && this._hass.states[cfg.secondary];
        const sub = subE ? subE.state + (subE.attributes.unit_of_measurement ? " " + subE.attributes.unit_of_measurement : "")
          : (give ? this._t("supplying") : on ? "" : this._t("off"));
        const node = this._node(d.key, { name: cfg.name || (this._hass.states[cfg.entity]?.attributes.friendly_name) || cfg.entity,
          icon: cfg.icon || DEFAULT_ICONS.device, color, value: d.power == null ? this._t("unavailable") : this._fmt(Math.abs(d.power)),
          sub, on, entity: cfg.entity, navigate: cfg.navigate });
        if (side === "left") { left.push(node); this._flows.push({ from: d.key, to: "home", p: d.power == null ? null : -d.power, color }); }
        else { right.push(node); this._flows.push({ from: "home", to: d.key, p: d.power, color }); }
      });
    }
    if (c.show_rest && m.devices.length) {
      const rest = m.rest + restExtra;
      right.push(this._node("rest", { name: c.rest_name || this._t("rest"), icon: DEFAULT_ICONS.rest, color: DEFAULT_COLORS.rest,
        value: this._fmt(rest), sub: restCount ? "+ " + restCount + " " + this._t("devices_n") : "", on: rest > minP, entity: hc.entity }));
      this._flows.push({ from: "home", to: "rest", p: rest, color: DEFAULT_COLORS.rest });
    }
    this._place(this._el.left, left);
    this._place(this._el.right, right);
    this._el.right.hidden = !right.length;
    this._el.left.hidden = !left.length;

    this._renderExtra();
    this._renderLegend();
    this._renderChart(false);
    requestAnimationFrame(() => this._drawLines());
  }

  _place(parent, nodes) {
    // keep existing elements, only reorder/append/remove
    nodes.forEach((n, i) => { if (parent.children[i] !== n) parent.insertBefore(n, parent.children[i] || null); });
    while (parent.children.length > nodes.length) parent.removeChild(parent.lastChild);
  }

  _drawLines() {
    if (!this._flows || !this._el) return;
    const svg = this._el.svg, box = this._el.grid.getBoundingClientRect();
    if (!box.width) return;
    const rect = (key) => { const n = this._nodes[key]; if (!n || !n.isConnected) return null; return n.getBoundingClientRect(); };
    const hb = rect("home"); if (!hb) return;
    const minP = this._config.min_power, dots = this._config.animation === "dots" && this._mode !== "today";
    // spread the connection points along the home edges, one per line
    const inn = this._flows.filter((f) => f.to === "home" && f.dir !== "v"), out = this._flows.filter((f) => f.to !== "home");
    const spot = (list, f) => { const i = list.indexOf(f), n = list.length, pad = hb.height * 0.22;
      return hb.top + pad + (hb.height - 2 * pad) * (n === 1 ? 0.5 : i / (n - 1)) - box.top; };
    let html = "";
    this._flows.forEach((f, i) => {
      const active = f.p != null && Math.abs(f.p) > minP;
      let a, b, vert = f.dir === "v";
      if (vert) {
        const r = rect(f.from); if (!r) return;
        const above = r.bottom <= hb.top + 1;
        a = { x: r.left + r.width / 2 - box.left, y: (above ? r.bottom : r.top) - box.top };
        b = { x: hb.left + hb.width / 2 - box.left, y: (above ? hb.top : hb.bottom) - box.top };
      } else if (f.to === "home") {
        const r = rect(f.from); if (!r) return;
        a = { x: r.right - box.left, y: r.top + r.height / 2 - box.top };
        const y = spot(inn, f), cy = hb.top + hb.height / 2 - box.top, rr = hb.width / 2, dy = Math.min(rr * 0.92, Math.abs(y - cy));
        b = { x: hb.left + rr - Math.sqrt(rr * rr - dy * dy) - box.left, y };
      } else {
        const r = rect(f.to); if (!r) return;
        const y = spot(out, f), cy = hb.top + hb.height / 2 - box.top, rr = hb.width / 2, dy = Math.min(rr * 0.92, Math.abs(y - cy));
        a = { x: hb.left + rr + Math.sqrt(rr * rr - dy * dy) - box.left, y };
        b = { x: r.left - box.left, y: r.top + r.height / 2 - box.top };
      }
      let d;
      if (this._config.lines === "orthogonal") d = this._ortho(a, b, vert);
      else if (vert) {
        const dy = (b.y - a.y) * 0.5;
        d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${a.x.toFixed(1)},${(a.y + dy).toFixed(1)} ${b.x.toFixed(1)},${(b.y - dy).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      } else {
        const dx = Math.max(12, (b.x - a.x) * 0.55);
        d = `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${(a.x + dx).toFixed(1)},${a.y.toFixed(1)} ${(b.x - dx).toFixed(1)},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      }
      const w = active ? this._width(f.p) : 1.2;
      const color = active ? f.color : "var(--divider-color, rgba(127,127,127,.35))";
      html += `<path id="thef-p${i}" d="${d}" fill="none" stroke="${color}" stroke-width="${w.toFixed(1)}" stroke-linecap="butt" opacity="${active ? 0.75 : 0.5}"/>`;
      if (dots && active) {
        const rev = f.p < 0;   // flow against the drawn direction (export, charging)
        const p = Math.min(Math.abs(f.p), this._config.max_power) / this._config.max_power;
        const dur = (3.2 - 2 * Math.sqrt(p)).toFixed(2);
        for (let k = 0; k < 3; k++) {
          html += `<circle class="dot" r="2.6" fill="#fff" opacity=".9">` +
            `<animateMotion dur="${dur}s" begin="${(k * dur / 3).toFixed(2)}s" repeatCount="indefinite"` +
            (rev ? ` keyPoints="1;0" keyTimes="0;1" calcMode="linear"` : "") + `><mpath href="#thef-p${i}"/></animateMotion></circle>`;
        }
      }
    });
    if (svg.__h !== html) { svg.__h = html; svg.innerHTML = html; }
  }



  // ---------- current price chip: colour = position between today's lowest and highest price, plus next change ----------
  _renderPrice() {
    const c = this._config, pc = c.price || (c.chart && c.chart.price), chip = this._el.pchip;
    const pe = pc && pc.entity && this._hass.states[pc.entity];
    this._priceInfo = null;
    chip.hidden = !pe || pc.show === false; if (chip.hidden) return;
    const cur = parseFloat(pe.state); if (isNaN(cur)) { chip.hidden = true; return; }
    const arr = pe.attributes[pc.attribute || "prices"] || [], sk = pc.start_key || "start", vk = pc.value_key || "price";
    const pts = arr.map((x) => Array.isArray(x) ? [+x[0], +x[1]] : [Date.parse(x[sk]), +x[vk]]).filter((x) => !isNaN(x[0]) && !isNaN(x[1])).sort((a, b) => a[0] - b[0]);
    const now = Date.now(), day = new Date(); day.setHours(0, 0, 0, 0);
    const today = pts.filter((p) => p[0] >= day.getTime() && p[0] < day.getTime() + 86400000).map((p) => p[1]);
    const lo = today.length ? Math.min(...today) : cur, hi = today.length ? Math.max(...today) : cur;
    const f = hi > lo ? Math.min(1, Math.max(0, (cur - lo) / (hi - lo))) : 0.5;
    const color = `hsl(${(120 - 120 * f).toFixed(0)},62%,46%)`;
    const nxt = pts.find((p) => p[0] > now && Math.abs(p[1] - cur) > 0.0005);
    const loc = this._hass.language, dec = pc.decimals != null ? pc.decimals : 3;
    const fmt = (v) => (pc.prefix != null ? pc.prefix : "€ ") + v.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const icon = f < 0.34 ? "mdi:arrow-down-bold" : f > 0.66 ? "mdi:arrow-up-bold" : "mdi:minus-thick";
    let sub = "";
    if (nxt) { const d = new Date(nxt[0]); sub = (nxt[1] < cur ? "lager: " : "hoger: ") + fmt(nxt[1]) + " " + this._t("at") + " " + d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"); }
    this._priceInfo = { color, text: fmt(cur), trend: nxt ? (nxt[1] < cur ? "mdi:arrow-bottom-right" : "mdi:arrow-top-right") : null,
      title: nxt ? fmt(nxt[1]) + " " + this._t("at") + " " + new Date(nxt[0]).getHours() + ":" + String(new Date(nxt[0]).getMinutes()).padStart(2, "0") : "" };
    if ((pc.position || "grid") !== "header") { chip.hidden = true; return; }
    const sig = [color, icon, fmt(cur), sub].join("|"); if (chip.__sig === sig) return; chip.__sig = sig;
    chip.style.setProperty("--pc", color);
    chip.innerHTML = `<div class="dot"><ha-icon icon="${icon}"></ha-icon></div><div><div class="pv"></div><div class="pn"></div></div>`;
    chip.querySelector(".pv").textContent = fmt(cur); chip.querySelector(".pn").textContent = sub;
    if (!chip.__click) { chip.__click = true; chip.addEventListener("click", () => this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: pc.entity }, bubbles: true, composed: true }))); }
  }

  // ---------- gas / water ----------
  _renderExtra() {
    const c = this._config, box = this._el.extra, items = [];
    for (const k of ["gas", "water"]) {
      const x = c[k]; if (!x) continue;
      const st = x.entity && this._hass.states[x.entity];
      let td = x.today && this._hass.states[x.today];
      if (!td && x.total) {   // today's usage from long-term statistics of a total meter
        this._tot = this._tot || {}; const c0 = this._tot[x.total];
        if (!c0 || Date.now() - c0.t > 300000) {
          this._tot[x.total] = { t: Date.now(), v: c0 ? c0.v : null };
          this._hass.callWS({ type: "recorder/statistic_during_period", statistic_id: x.total, calendar: { period: "day" }, types: ["change"] })
            .then((r) => { this._tot[x.total].v = r.change; this._sig = null; this._render(); }).catch(() => {});
        }
        const te = this._hass.states[x.total], v = this._tot[x.total].v;
        if (v != null) td = { state: String(v), attributes: { unit_of_measurement: te ? te.attributes.unit_of_measurement : "" } };
      }
      const fmt = (e) => { const n = parseFloat(e.state); return isNaN(n) ? e.state : n.toLocaleString(this._hass.language, { maximumFractionDigits: x.decimals != null ? x.decimals : 2 }) + " " + (e.attributes.unit_of_measurement || ""); };
      items.push({ k, name: x.name || this._t(k), icon: x.icon || (k === "gas" ? "mdi:fire" : "mdi:water"), color: x.color || (k === "gas" ? "#ff9f0a" : "#5ac8fa"),
        v: st ? fmt(st) : "", sub: td ? this._t("today") + " " + fmt(td) : "", ent: x.entity || x.today || x.total });
    }
    const sig = JSON.stringify(items); if (sig === box.__sig) return; box.__sig = sig;
    box.innerHTML = "";
    items.forEach((it) => {
      const el = document.createElement("div"); el.className = "xt"; el.style.setProperty("--c", it.color);
      el.innerHTML = `<ha-icon icon="${it.icon}"></ha-icon><div style="min-width:0"><div class="n"></div><div class="v"></div><div class="s"></div></div>`;
      el.querySelector(".n").textContent = it.name; el.querySelector(".v").textContent = it.v; el.querySelector(".s").textContent = it.sub;
      el.addEventListener("click", () => it.ent && this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: it.ent }, bubbles: true, composed: true })));
      box.appendChild(el);
    });
  }

  // ---------- legend ----------
  _renderLegend() {
    const c = this._config, L = this._el.legend;
    L.hidden = c.legend === false;
    if (L.hidden || L.__done === this._t("legend") + JSON.stringify(c.sources) + c.devices.length) return;
    L.__done = this._t("legend") + JSON.stringify(c.sources) + c.devices.length;
    L.querySelector("summary").textContent = this._t("legend");
    const s = c.sources, items = [];
    if (s.solar) items.push([s.solar.color || DEFAULT_COLORS.solar, s.solar.name || this._t("solar")]);
    if (s.grid) { items.push([s.grid.color || DEFAULT_COLORS.grid, (s.grid.name || this._t("grid")) + " · " + this._t("import")]);
      items.push([s.grid.export_color || DEFAULT_COLORS.grid_export, (s.grid.name || this._t("grid")) + " · " + this._t("export")]); }
    if (s.battery) items.push([s.battery.color || DEFAULT_COLORS.battery, s.battery.name || this._t("battery")]);
    if (c.devices.length) items.push([DEFAULT_COLORS.device, this._t("consumers")], [DEFAULT_COLORS.rest, c.rest_name || this._t("rest")]);
    const lg = this._el.lg; lg.innerHTML = "";
    items.forEach(([col, txt]) => { const e = document.createElement("span"); e.innerHTML = `<i style="background:${col}"></i>`; e.append(txt); lg.appendChild(e); });
    const pcf = c.price || (c.chart && c.chart.price);
    const extraTxt = [this._t("ring"), this._t("lines")].concat(pcf && pcf.entity && pcf.show !== false ? [this._t("price_legend")] : []);
    for (const t of extraTxt) { const e = document.createElement("span"); e.className = "w"; e.textContent = t; lg.appendChild(e); }
  }

  // ---------- charts ----------
  _chartTabs() {
    const c = this._config, ch = c.chart; if (!ch) return [];
    const s = c.sources, want = ch.tabs || ["price", "solar", "battery", "home"], tabs = [];
    for (const t of want) {
      if (t === "price" && ch.price && ch.price.entity) tabs.push({ id: "price", name: this._t("price") });
      if (t === "solar" && s.solar && s.solar.entity) tabs.push({ id: "solar", name: s.solar.name || this._t("solar"), ent: s.solar.entity, color: s.solar.color || DEFAULT_COLORS.solar });
      if (t === "battery" && s.battery && s.battery.soc) tabs.push({ id: "battery", name: this._t("soc"), ent: s.battery.soc, color: s.battery.color || DEFAULT_COLORS.battery, unit: "%", max: 100 });
      if (t === "home" && c.home && c.home.entity) tabs.push({ id: "home", name: this._t("consumption"), ent: c.home.entity, color: (c.home.color) || DEFAULT_COLORS.home });
    }
    return tabs;
  }
  async _history(ent, hours) {
    this._hcache = this._hcache || {};
    const h = this._hcache[ent];
    if (h && Date.now() - h.t < 300000) return h.d;
    const start = new Date(Date.now() - hours * 3600000).toISOString();
    try {
      const r = await this._hass.callWS({ type: "history/history_during_period", start_time: start, end_time: new Date().toISOString(),
        entity_ids: [ent], minimal_response: true, no_attributes: true, significant_changes_only: false });
      const rows = (r && r[ent]) || [];
      const d = rows.map((x) => [((x.lu || x.lc || 0) * 1000), parseFloat(x.s)]).filter((x) => !isNaN(x[1]) && x[0] > 0);
      this._hcache[ent] = { t: Date.now(), d };
      return d;
    } catch (e) { return []; }
  }
  async _renderChart(force) {
    const tabs = this._chartTabs(), box = this._el.charts;
    box.hidden = !tabs.length; if (!tabs.length) return;
    if (this._chOpen == null) { let v = null; try { v = localStorage.getItem("thef-charts-open"); } catch (_) {}
      this._chOpen = v == null ? !(this._config.chart && this._config.chart.collapsed) : v === "1"; }
    box.classList.toggle("open", this._chOpen);
    const hd = box.querySelector(".chead"); if (hd.textContent !== this._t("charts")) hd.textContent = this._t("charts");
    if (!this._chOpen) return;
    if (!tabs.find((t) => t.id === this._tab)) this._tab = tabs[0].id;
    const tsig = tabs.map((t) => t.id + t.name).join("|") + this._tab;
    if (this._el.tabs.__sig !== tsig) { this._el.tabs.__sig = tsig;
      this._el.tabs.innerHTML = tabs.map((t) => `<div class="tab${t.id === this._tab ? " sel" : ""}" data-tab="${t.id}"></div>`).join("");
      tabs.forEach((t, i) => (this._el.tabs.children[i].textContent = t.name)); }
    if (!force && this._chartT && Date.now() - this._chartT < 60000) return;
    this._chartT = Date.now();
    const tab = tabs.find((t) => t.id === this._tab), W = Math.max(200, this._el.chart.clientWidth || 320), H = 140, L = 34, B = 18;
    const ch = this._config.chart, hours = ch.hours || 24;
    let svg = "";
    const xs = (t, t0, t1) => L + (t - t0) / (t1 - t0) * (W - L - 4);
    const yTicks = (lo, hi, fmt) => [hi, (lo + hi) / 2, lo].map((v, i) => `<text x="${L - 4}" y="${(4 + i * (H - B - 8) / 2 + 4).toFixed(0)}" text-anchor="end" font-size="10" fill="currentColor" opacity=".55">${fmt(v)}</text>`).join("");
    const xTicks = (t0, t1) => { let o = ""; const st = 6 * 3600000; for (let t = Math.ceil(t0 / st) * st; t <= t1; t += st) { const d = new Date(t);
      o += `<text x="${xs(t, t0, t1).toFixed(0)}" y="${H - 4}" text-anchor="middle" font-size="10" fill="currentColor" opacity=".55">${d.getHours()}:00</text>`; } return o; };
    const loc = this._hass.language;
    if (tab.id === "price") {
      const pe = this._hass.states[ch.price.entity];
      const arr = (pe && pe.attributes[ch.price.attribute || "prices"]) || [];
      const sk = ch.price.start_key || "start", vk = ch.price.value_key || "price";
      const now = Date.now(), t0 = now - 2 * 3600000, t1 = t0 + hours * 3600000;
      const pts = arr.map((x) => Array.isArray(x) ? [+x[0], +x[1]] : [Date.parse(x[sk]), +x[vk]]).filter((x) => !isNaN(x[0]) && !isNaN(x[1]) && x[0] >= t0 - 3600000 && x[0] < t1);
      if (!pts.length) { this._el.chart.innerHTML = `<div class="leeg">${this._t("nodata")}</div>`; return; }
      const lo = Math.min(0, ...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])) * 1.05, span = (hi - lo) || 1;
      const step = pts.length > 1 ? Math.min(...pts.slice(1).map((p, i) => p[0] - pts[i][0]).filter((x) => x > 0)) : 3600000;
      const pmin = Math.min(...pts.map((p) => p[1])), pmax = Math.max(...pts.map((p) => p[1]));
      const colr = (v) => { const f = pmax > pmin ? (v - pmin) / (pmax - pmin) : 0; const h = 120 - 120 * f; return `hsl(${h.toFixed(0)},62%,50%)`; };
      pts.forEach(([t, v]) => { const x0 = Math.max(L, xs(t, t0, t1)), x1 = Math.min(W - 4, xs(t + step, t0, t1)); if (x1 <= L) return;
        const y = 4 + (1 - (v - lo) / span) * (H - B - 8), y0 = 4 + (1 - (0 - lo) / span) * (H - B - 8);
        svg += `<rect x="${(x0 + .5).toFixed(1)}" y="${Math.min(y, y0).toFixed(1)}" width="${Math.max(1, x1 - x0 - 1).toFixed(1)}" height="${Math.abs(y0 - y).toFixed(1)}" rx="1.5" fill="${colr(v)}" opacity="${t + step < now ? .45 : .9}"/>`; });
      const xn = xs(now, t0, t1);
      svg += `<line x1="${xn}" x2="${xn}" y1="2" y2="${H - B}" stroke="var(--primary-color,#03a9f4)" stroke-width="2"/>`;
      svg += yTicks(lo, hi, (v) => v.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + xTicks(t0, t1);
    } else {
      const d = await this._history(tab.ent, hours);
      const now = Date.now(), t0 = now - hours * 3600000;
      if (!d.length) { this._el.chart.innerHTML = `<div class="leeg">${this._t("nodata")}</div>`; return; }
      const unitW = tab.unit !== "%";
      const bucket = 5 * 60000, bins = new Map();
      d.forEach(([t, v]) => { const k = Math.floor(Math.max(t, t0) / bucket); const b = bins.get(k) || [0, 0]; b[0] += v; b[1]++; bins.set(k, b); });
      let pts = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([k, b]) => [k * bucket, b[0] / b[1]]);
      if (pts.length) pts.push([now, pts[pts.length - 1][1]]);
      const lo = Math.min(0, ...pts.map((p) => p[1])), hi = tab.max || Math.max(1, ...pts.map((p) => p[1])) * 1.08, span = (hi - lo) || 1;
      const Y = (v) => 4 + (1 - (v - lo) / span) * (H - B - 8);
      const line = pts.map((p, i) => `${i ? "L" : "M"}${xs(p[0], t0, now).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ");
      const y0 = Y(Math.max(lo, Math.min(0, hi)));   // fill towards zero, also for negative values (export)
      svg += `<path d="${line} L${xs(now, t0, now).toFixed(1)},${y0.toFixed(1)} L${xs(pts[0][0], t0, now).toFixed(1)},${y0.toFixed(1)} Z" fill="${tab.color}" opacity=".18"/>`;
      if (lo < 0) svg += `<line x1="${L}" x2="${W - 4}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}" stroke="currentColor" stroke-opacity=".35" stroke-dasharray="2 3"/>`;
      svg += `<path d="${line}" fill="none" stroke="${tab.color}" stroke-width="2" stroke-linejoin="round"/>`;
      const f = (v) => unitW ? (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString(loc, { maximumFractionDigits: 1 }) + "k" : Math.round(v)) : Math.round(v) + "%";
      svg += (lo < 0 ? [hi, 0, lo].map((v) => `<text x="${L - 4}" y="${(Y(v) + 4).toFixed(0)}" text-anchor="end" font-size="10" fill="currentColor" opacity=".55">${f(v)}</text>`).join("") : yTicks(lo, hi, f)) + xTicks(t0, now);
    }
    this._el.chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${svg}</svg>`;
  }

  _ortho(a, b, vert) {
    const f = (v) => v.toFixed(1);
    if (vert) {
      if (Math.abs(b.x - a.x) < 1) return `M${f(a.x)},${f(a.y)} L${f(b.x)},${f(b.y)}`;
      const my = (a.y + b.y) / 2, sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
      const r = Math.min(10, Math.abs(b.x - a.x) / 2, Math.abs(my - a.y));
      return `M${f(a.x)},${f(a.y)} V${f(my - r * sy)} Q${f(a.x)},${f(my)} ${f(a.x + r * sx)},${f(my)} H${f(b.x - r * sx)} Q${f(b.x)},${f(my)} ${f(b.x)},${f(my + r * sy)} V${f(b.y)}`;
    }
    if (Math.abs(b.y - a.y) < 1) return `M${f(a.x)},${f(a.y)} L${f(b.x)},${f(b.y)}`;
    const mx = (a.x + b.x) / 2, sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
    const r = Math.min(10, Math.abs(b.y - a.y) / 2, Math.abs(mx - a.x));
    return `M${f(a.x)},${f(a.y)} H${f(mx - r * sx)} Q${f(mx)},${f(a.y)} ${f(mx)},${f(a.y + r * sy)} V${f(b.y - r * sy)} Q${f(mx)},${f(b.y)} ${f(mx + r * sx)},${f(b.y)} H${f(b.x)}`;
  }

  disconnectedCallback() { if (this._ro) this._ro.disconnect(); }
  connectedCallback() { if (this._ro && this._el) this._ro.observe(this._el.grid); }
}

if (!customElements.get("total-home-energy-flow-card")) {
  customElements.define("total-home-energy-flow-card", TotalHomeEnergyFlowCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "total-home-energy-flow-card",
    name: "Total Home Energy Flow Card",
    description: "Live energy flow of the whole home: solar, grid, battery and any number of devices.",
    preview: false,
    documentationURL: "https://github.com/gjvdveen/total-home-energy-flow-card",
  });
  console.info(`%c TOTAL-HOME-ENERGY-FLOW-CARD %c v${THEF_VERSION} `, "background:#34c759;color:#fff;font-weight:700", "");
}

// =====================================================================
// Total Home Energy Ring Card — compact overview: battery ring in the
// middle, power arcs (optionally per phase) for sources and loads.
// =====================================================================
class TotalHomeEnergyRingCard extends HTMLElement {
  static getStubConfig() { return { battery: { soc: "" }, left: [{ name: "Grid", entity: "" }], right: [{ name: "Home", entity: "" }] }; }
  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    const c = JSON.parse(JSON.stringify(config));
    c.left = Array.isArray(c.left) ? c.left.slice(0, 8) : [];   // per page the visible number is limited later
    c.right = Array.isArray(c.right) ? c.right.slice(0, 8) : [];   // per page the visible number is limited later
    // rest: { name, icon, color, of } – "everything else": the home total minus all listed consumers
    if (c.rest) { const r = c.rest === true ? {} : c.rest;
      c.right = c.right.filter((g) => !g._rest).concat([{ name: r.name || "Overig", icon: r.icon || "mdi:dots-horizontal-circle-outline", color: r.color || "#8e8e93", of: r.of, entity: r.entity, energy: r.energy, _rest: true, max: r.max }]); }
    c.battery = c.battery || null;
    c.max_power = Number(c.max_power) > 0 ? Number(c.max_power) : 10000;
    c.kw_from = Number(c.kw_from) > 0 ? Number(c.kw_from) : 1000;
    this._config = c; this._sig = null;
    if (!this.shadowRoot) this._build();
    if (this._hass) this._render();
  }
  getCardSize() { return 4; }
  getGridOptions() { return { columns: "full", rows: "auto", min_columns: 6 }; }
  set hass(h) { this._hass = h; this._render(); }
  _fmtHtml(w) {
    if (w == null) return "–";
    if (this._eMode) {   // energy (Wh) -> kWh
      const loc = this._hass?.locale?.language || this._hass?.language || "en", k = Math.abs(w) / 1000;
      return `${k.toLocaleString(loc, { minimumFractionDigits: k >= 10 ? 1 : 2, maximumFractionDigits: k >= 10 ? 1 : 2 })}<span class="u"> kWh</span>`;
    }
    const loc = this._hass?.locale?.language || this._hass?.language || "en", a = Math.abs(w);
    const [n, u] = a >= this._config.kw_from ? [(a / 1000).toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), "kW"] : [Math.round(a).toLocaleString(loc), "W"];
    return `${n}<span class="u"> ${u}</span>`;
  }
  _build() {
    const r = this.attachShadow({ mode: "open" });
    r.innerHTML = `<style>
      :host { display:block; }
      .card { border-radius: var(--ha-card-border-radius, 22px); padding:14px; box-sizing:border-box; background: var(--ha-card-background, var(--card-background-color, #1c1c1e)); color: var(--primary-text-color); overflow:hidden; container-type:inline-size; }
      [hidden] { display:none !important; }
      .head { display:flex; align-items:center; gap:10px; margin:0 2px 6px; } .title { font-size:15px; font-weight:500; flex:1; min-width:0; color: var(--thef-title, var(--secondary-text-color)); letter-spacing:.2px; }
      .pg { display:flex; padding:2px; border-radius:12px; background: rgba(127,127,127,.16); flex:0 0 auto; }
      .pg span { padding:3px 9px; border-radius:10px; cursor:pointer; display:flex; opacity:.55; } .pg ha-icon { --mdc-icon-size:17px; }
      .pg span.sel { background: var(--ha-card-background, var(--card-background-color, #2c2c2e)); opacity:1; box-shadow:0 1px 3px rgba(0,0,0,.25); }
      .ov { position:relative; width:100%; aspect-ratio: 400 / 250; max-width:560px; margin:0 auto; }
      .ov svg { z-index:0; } .ov path { fill:none; stroke-width:2.2; stroke-linecap:round; }
      .ov.static path.flow { animation:none; stroke-dasharray:none; stroke-width:2.6; opacity:.9; }
      .ov path.flow { stroke-dasharray: 1 7; stroke-width:3.2; animation: thefdash 1.1s linear infinite; }
      @keyframes thefdash { to { stroke-dashoffset: -16; } } .ov path.flow.rev { animation-direction: reverse; }
      @media (prefers-reduced-motion: reduce) { .ov path.flow { animation:none; } }
      .tile { position:absolute; box-sizing:border-box; border:1.5px solid rgba(127,127,127,.35); border-radius:12px; padding:5px 8px; overflow:hidden; cursor:pointer; z-index:1;
        background: var(--ha-card-background, var(--card-background-color, #1c1c1e)); display:flex; flex-direction:column; min-width:0; }
      .prc { position:absolute; z-index:1; box-sizing:border-box; display:flex; align-items:center; justify-content:center; gap:6px; border-radius:999px; background: rgba(127,127,127,.16); cursor:pointer;
        font-size: clamp(11px, 3.2cqw, 15px); font-weight:600; font-variant-numeric: tabular-nums; white-space:nowrap; }
      .prc i { width:8px; height:8px; border-radius:50%; flex:0 0 auto; } .prc ha-icon { --mdc-icon-size: clamp(13px, 3.6cqw, 17px); opacity:.7; }
      .port { position:absolute; z-index:2; transform:translate(-50%,-50%); padding:1px 7px; border-radius:8px; white-space:nowrap;
        font-size: clamp(8.5px, 2.4cqw, 11px); font-weight:500; letter-spacing:.2px; color: color-mix(in srgb, var(--primary-text-color, #fff) 70%, transparent);
        background: var(--ha-card-background, var(--card-background-color, #1c1c1e)); border:1px solid rgba(127,127,127,.4); }
      .tile.on { border-color: var(--c); } .tile:not(.on) { opacity:.6; }
      .tile .th { display:flex; align-items:center; gap:4px; font-size: clamp(10px, 2.9cqw, 13px); opacity:.8; white-space:nowrap; overflow:hidden; }
      .tile .th ha-icon { --mdc-icon-size: clamp(12px, 3.4cqw, 16px); color: var(--c); flex:0 0 auto; }
      .tile ha-icon.ar { --mdc-icon-size:.8em; opacity:.6; margin-right:3px; vertical-align:-.05em; } .tile .ts ha-icon.ar { --mdc-icon-size:1em; margin-right:2px; }
      .tile .tv { font-size: clamp(14px, 4.6cqw, 24px); font-weight:600; font-variant-numeric: tabular-nums; white-space:nowrap; line-height:1.2; overflow:hidden; text-overflow:ellipsis; }
      .tile .tv.txt { font-size: clamp(12px, 3.6cqw, 18px); white-space:normal; line-height:1.15; }
      .tile.inv .tv.txt { font-size: clamp(11px, 3.1cqw, 15px); font-weight:600; margin:auto 0; padding-bottom:4px; align-self:stretch; text-align:center; text-wrap:balance; }
      .tile.inv .th { justify-content:center; } .tile .model { font-size: clamp(8.5px, 2.2cqw, 10.5px); opacity:.45; letter-spacing:.2px; text-align:center; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .tile .th img.logo { height: clamp(10px, 3cqw, 15px); max-width:60%; object-fit:contain; } .tile.inv.ph .tv.txt { margin:4px 0 0; } .tile.inv .pb { text-align:left; }
      .tile .tp { display:grid; grid-template-columns:auto 1fr; column-gap:6px; font-size: clamp(9.5px, 2.6cqw, 12px); opacity:.7; font-variant-numeric: tabular-nums; margin-top:auto; line-height:1.25; }
      .tile .tp b { font-weight:400; text-align:right; white-space:nowrap; }
      .tile.sm { padding:3px 8px; justify-content:center; gap:0; } .tile.sm .tv { font-size: clamp(13px, 4cqw, 20px); line-height:1.1; } .tile.sm .th { font-size: clamp(9.5px, 2.6cqw, 12px); }
      .tile .ts.t2 { margin-top:0; } .tile .ts { font-size: clamp(9.5px, 2.6cqw, 12px); opacity:.75; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:auto; font-variant-numeric: tabular-nums; }
      .tile.bat { background: linear-gradient(to top, color-mix(in srgb, var(--c) 24%, transparent) var(--soc, 0%), transparent var(--soc, 0%)), var(--ha-card-background, var(--card-background-color, #1c1c1e)); }
      .stage { position:relative; width:100%; aspect-ratio: 400 / 290; max-width:560px; margin:0 auto; }
      svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
      .trk { fill:none; stroke: rgba(127,127,127,.18); stroke-linecap:round; } .trk.t { stroke: var(--tc); stroke-opacity:.22; }
      .val { fill:none; stroke-linecap:round; transition: d .6s; }
      .ph { font-size:9px; fill: var(--secondary-text-color); opacity:.8; }
      .lab { position:absolute; transform: translateY(-50%); display:flex; flex-direction:column; gap:0; cursor:pointer; min-width:0; }
      .lab.l { align-items:flex-start; text-align:left; } .lab.r { align-items:flex-end; text-align:right; }
      .lab .row { display:flex; align-items:center; gap:4px; white-space:nowrap; }
      .lab ha-icon { --mdc-icon-size:16px; color: var(--c); }
      .lab .v { font-size: clamp(14px, 5cqw, 26px); font-weight:600; font-variant-numeric: tabular-nums; line-height:1.15; }
      .lab .n { font-size: clamp(10px, 2.8cqw, 13px); opacity:.7; white-space:nowrap; display:flex; align-items:center; gap:3px; }
      .lab .ar { display:flex; align-items:center; gap:4px; height: clamp(16px, 4.6cqw, 22px); } .lab .ar ha-icon { --mdc-icon-size: clamp(15px, 4.4cqw, 21px); } .lab .ar .ai { color: var(--a); } .lab .ar .gi { opacity:.8; }
      .lab .row ha-icon { --mdc-icon-size: clamp(14px, 4.2cqw, 20px); opacity:.85; color: var(--primary-text-color); }
      .lab .n ha-icon { --mdc-icon-size: clamp(12px, 3.4cqw, 16px); }
      .u { font-size:.68em; font-weight:500; opacity:.7; }
      .charts { margin-top:14px; }
      .chead { font-size:12px; opacity:.7; font-weight:500; cursor:pointer; user-select:none; margin-bottom:8px; }
      .chead::before { content:"▸ "; } .charts.open .chead::before { content:"▾ "; }
      .charts:not(.open) .cbody { display:none; } .charts:not(.open) .chead { margin-bottom:0; }
      .tabs { display:flex; gap:6px; margin-bottom:8px; flex-wrap:wrap; justify-content:center; }
      .cline { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; } .cline .chead { margin-bottom:0; } .charts:not(.open) .cline { margin-bottom:0; }
      .pfoot { display:flex; align-items:center; gap:5px; font-size:12px; font-weight:500; opacity:.7; cursor:pointer; white-space:nowrap; font-variant-numeric: tabular-nums; }
      .ppan { margin:0 0 10px auto; width:max-content; max-width:100%; font-size:12px; font-variant-numeric: tabular-nums; cursor:pointer; display:grid; grid-template-columns:7px auto auto auto; align-items:center; column-gap:10px; line-height:1.7; }
      .ppan[hidden] { display:none; } .ppan .ph { grid-column:1 / -1; opacity:.55; font-size:11px; margin-top:4px; line-height:1.4; } .ppan .ph:first-child { margin-top:0; }
      .ppan .pr { display:contents; }
      .ppan .pr i { width:7px; height:7px; border-radius:50%; } .ppan .l { opacity:.7; } .ppan .t { opacity:.7; text-align:right; } .ppan b { font-weight:600; text-align:right; }
      .pfoot ha-icon { transition: transform .2s; } .pfoot.open ha-icon { transform: rotate(90deg); }
      .pfoot i { width:7px; height:7px; border-radius:50%; flex:0 0 auto; } .pfoot ha-icon { --mdc-icon-size:13px; } .pfoot .u { font-size:1em; }
      .tab { padding:5px 12px; border-radius:14px; font-size:12.5px; font-weight:600; background: rgba(127,127,127,.16); cursor:pointer; user-select:none; }
      .tab.sel { background: var(--primary-color, #03a9f4); color:#fff; }
      .chart { position:relative; height:140px; } .chart svg { position:static; width:100%; height:100%; display:block; overflow:visible; }
      .chart .leeg { font-size:12px; opacity:.6; padding-top:50px; text-align:center; }
      .mid .mh { display:flex; align-items:center; gap:4px; font-size: clamp(11px, 3.4cqw, 16px); opacity:.85; }
      .ls { display:grid; grid-template-columns: 47% 1fr; gap:5%; align-items:center; max-width:640px; margin:4px auto 0; }
      .lring { position:relative; width:100%; aspect-ratio:1; container-type:inline-size; }
      .lring .mid { width:78%; } .lring .mid .soc { font-size: 27cqw; } .lring .mid .s, .lring .mid .mh { font-size: clamp(10px, 7.5cqw, 16px); }
      .rows { display:flex; flex-direction:column; gap: clamp(8px, 3cqw, 16px); min-width:0; }
      .rw { cursor:pointer; min-width:0; }
      .rw .rh { display:flex; align-items:center; gap:5px; font-size: clamp(11px, 3cqw, 14px); opacity:.8; }
      .rw .rh ha-icon { --mdc-icon-size: clamp(14px, 3.8cqw, 18px); }
      .rw .rv { display:flex; align-items:center; gap:6px; min-width:0; }
      .rw .rv ha-icon { --mdc-icon-size: clamp(14px, 4.2cqw, 22px); color: var(--a); flex:0 0 auto; }
      .rw .v { font-size: clamp(18px, 6.2cqw, 30px); font-weight:600; font-variant-numeric: tabular-nums; white-space:nowrap; line-height:1.15; }
      .rw svg.sp { position:static; flex:1; height: clamp(18px, 5cqw, 28px); min-width:30px; overflow:visible; }
      .rw .pb, .tile .pb { display:grid; gap:6px; margin-top:3px; }

      .rw .pb div, .tile .pb div { display:flex; align-items:center; gap:3px; font-size: clamp(9px, 2.4cqw, 11px); opacity:.85; }
      .rw .pb i, .tile .pb i { flex:1; height:5px; border-radius:3px; background: color-mix(in srgb, var(--c) 22%, transparent); position:relative; overflow:hidden; }
      .rw .pb i b, .tile .pb i b { position:absolute; left:0; top:0; bottom:0; border-radius:3px; background: var(--pc); min-width:3px; }
      .tile .pb { grid-template-columns:1fr; margin-top:auto; gap:3px; padding-bottom:2px; } .tile .pb div { gap:6px; line-height:1; font-size: clamp(9px, 2.4cqw, 11px); } .tile .pb i { height:7px; border-radius:4px; } .tile .pb i b { border-radius:4px; }
      .mid { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:41%; aspect-ratio:1; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer; text-align:center; }
      .mid ha-icon { --mdc-icon-size: clamp(14px, 4cqw, 20px); opacity:.8; }
      .mid .soc { font-size: clamp(32px, 13.5cqw, 68px); font-weight:600; line-height:1; font-variant-numeric: tabular-nums; }
      .mid .soc .u { font-size:.5em; }
      .mid .s { font-size: clamp(11px, 3.4cqw, 16px); opacity:.7; margin-top:2px; white-space:nowrap; line-height:1.2; }
    </style><div class="card"><div class="head"><div class="title"></div><div class="pg"><span data-p="ring"><ha-icon icon="mdi:circle-double"></ha-icon></span><span data-p="list"><ha-icon icon="mdi:format-list-bulleted-square"></ha-icon></span><span data-p="overview"><ha-icon icon="mdi:view-dashboard-outline"></ha-icon></span><span data-p="today"><ha-icon icon="mdi:calendar-today"></ha-icon></span></div></div>
      <div class="stage"><svg viewBox="0 0 400 290"></svg><div class="mid"><div class="mh"><ha-icon></ha-icon><span></span></div><div class="soc"></div><div class="s"></div></div></div>
      <div class="ls"><div class="lring"><svg viewBox="0 0 200 200"></svg><div class="mid m2"><div class="mh"><ha-icon></ha-icon><span></span></div><div class="soc"></div><div class="s"></div></div></div><div class="rows"></div></div>
      <div class="ov"><svg viewBox="0 0 400 250"></svg></div>
      <div class="charts" hidden><div class="cline"><div class="chead"></div><div class="pfoot" hidden></div></div><div class="ppan" hidden></div><div class="cbody"><div class="tabs"></div><div class="chart"></div></div></div></div>`;
    this._el = { title: r.querySelector(".title"), stage: r.querySelector(".stage"), svg: r.querySelector(".stage svg"), mid: r.querySelector(".mid"),
      ov: r.querySelector(".ov"), ovsvg: r.querySelector(".ov svg"), pg: r.querySelector(".pg") };
    r.querySelectorAll(".pg span").forEach((sp) => sp.addEventListener("click", () => {
      this._page = sp.dataset.p; try { localStorage.setItem("thef-ring-page", this._page); } catch (_) {} this._sig = null; this._render(); }));
    this._el.ls = r.querySelector(".ls"); this._el.lsvg = r.querySelector(".lring svg"); this._el.mid2 = r.querySelector(".m2"); this._el.rows = r.querySelector(".rows");
    Object.assign(this._el, { charts: r.querySelector(".charts"), tabs: r.querySelector(".tabs"), chart: r.querySelector(".chart"), pfoot: r.querySelector(".pfoot") });
    this._el.ppan = r.querySelector(".ppan");
    this._el.pfoot.addEventListener("click", () => { this._pOpen = !this._pOpen; this._sig = null; this._render(); });
    this._el.ppan.addEventListener("click", () => this._open({ entity: this._config.price.entity }));
    this._el.charts.querySelector(".chead").addEventListener("click", () => {
      this._chOpen = !this._chOpen; try { localStorage.setItem("thef-ring-charts-open", this._chOpen ? "1" : "0"); } catch (_) {}
      this._el.charts.classList.toggle("open", this._chOpen); if (this._chOpen) this._renderChart(true); });
    this._el.tabs.addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (!b) return; this._tab = b.dataset.tab; this._renderChart(true); });
    this._el.mid.addEventListener("click", () => this._open(this._config.battery));
    this._el.mid2.addEventListener("click", () => this._open(this._config.battery));
  }
  _open(cfg) {
    if (!cfg) return;
    if (cfg.navigate) { history.pushState(null, "", cfg.navigate); window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } })); return; }
    const ent = cfg.entity || cfg.soc || (cfg.phases && cfg.phases[0]) || cfg.charge;
    if (ent) this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: ent }, bubbles: true, composed: true }));
  }
  _group(g) {
    if (g.type === "meter" || g._rest) return { tot: null, ph: [] };
    const inv = (v) => (v == null ? null : g.invert ? -v : v);
    const ph = (g.phases || []).map((id) => inv(this._num(id)));
    let tot = g.entity ? inv(this._num(g.entity)) : null;
    if (tot == null && ph.length) tot = ph.reduce((a, v) => a + (v || 0), 0);
    return { tot, ph };
  }
  _arc(cx, cy, r, a1, a2, side) {   // angles in degrees from horizontal (up = +)
    const n = Math.max(2, Math.ceil(Math.abs(a2 - a1) / 3)), pts = [];
    for (let i = 0; i <= n; i++) { const a = (a1 + (a2 - a1) * i / n) * Math.PI / 180;
      pts.push(`${(cx + side * r * Math.cos(a)).toFixed(1)},${(cy - r * Math.sin(a)).toFixed(1)}`); }
    return "M" + pts.join("L");
  }
  _priceHtml(pc) {
    const c = this._config, v = parseFloat(pc.state), pcfg = c.price, loc = this._hass.language || "en";

      const arr = (pcfg.attribute && pc.attributes[pcfg.attribute]) || (c.chart && c.chart.price && pc.attributes[c.chart.price.attribute || "prices"]) || [];
      const sk = pcfg.start_key || (c.chart && c.chart.price && c.chart.price.start_key) || "start", vk = pcfg.value_key || (c.chart && c.chart.price && c.chart.price.value_key) || "price";
      const day = new Date().toDateString(), pts = arr.map((x) => [Date.parse(x[sk]), +x[vk]]).filter((x) => !isNaN(x[0]) && !isNaN(x[1]));
      const today = pts.filter((x) => new Date(x[0]).toDateString() === day).map((x) => x[1]);
      const lo = today.length ? Math.min(...today) : v, hi = today.length ? Math.max(...today) : v, f = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      const nxt = pts.find((x) => x[0] > Date.now()), tr = nxt ? (nxt[1] > v + 0.005 ? "mdi:arrow-top-right" : nxt[1] < v - 0.005 ? "mdi:arrow-bottom-right" : "mdi:arrow-right") : "";
    this._pPts = pts.sort((a, b) => a[0] - b[0]);
    return `<i style="background:hsl(${(120 - 120 * f).toFixed(0)},62%,50%)"></i><span>${pcfg.prefix != null ? pcfg.prefix : "€ "}${isNaN(v) ? pc.state : v.toLocaleString(loc, { minimumFractionDigits: pcfg.decimals != null ? pcfg.decimals : 3, maximumFractionDigits: pcfg.decimals != null ? pcfg.decimals : 3 })}<span class="u"> /kWh</span></span>${tr ? `<ha-icon icon="${tr}"></ha-icon>` : ""}`;
  }
  // unfolded price: cheapest and most expensive moment today (and tomorrow, when known)
  _pricePanel() {
    const pts = this._pPts || [], pcfg = this._config.price || {}, loc = this._hass.language || "en", dec = pcfg.decimals != null ? pcfg.decimals : 3, pre = pcfg.prefix != null ? pcfg.prefix : "€ ";
    const fm = (v) => pre + v.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const hm = (t) => new Date(t).toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" });
    const step = pts.length > 1 ? Math.min(...pts.slice(1).map((x, i) => x[0] - pts[i][0]).filter((d) => d > 0)) : 3600e3;
    const nl = (this._hass.language || "").startsWith("nl");
    const day = (off) => { const d = new Date(); d.setDate(d.getDate() + off); const k = d.toDateString(); return pts.filter((x) => new Date(x[0]).toDateString() === k); };
    const row = (lbl, list, pick) => { if (!list.length) return ""; const v = pick(...list.map((x) => x[1])), x = list.find((y) => y[1] === v);
      const hsl = pick === Math.min ? "120,62%,45%" : "0,62%,52%";
      return `<div class="pr"><i style="background:hsl(${hsl})"></i><span class="l">${lbl}</span><span class="t">${hm(x[0])}–${hm(x[0] + (isFinite(step) ? step : 3600e3))}</span><b>${fm(v)}</b></div>`; };
    const blk = (title, list) => list.length ? `<div class="ph">${title}</div>` + row(nl ? "Goedkoopst" : "Cheapest", list, Math.min) + row(nl ? "Duurst" : "Most expensive", list, Math.max) : "";
    const html = blk(nl ? "Vandaag" : "Today", day(0)) + blk(nl ? "Morgen" : "Tomorrow", day(1));
    return html || `<div class="ph">${this._t("nodata")}</div>`;
  }
  _render() {
    if (!this._hass || !this._config || !this._el) return;
    this._renderChart(false);
    const c = this._config, b = c.battery;
    const groups = { l: c.left.map((g) => ({ g, ...this._group(g) })), r: c.right.map((g) => ({ g, ...this._group(g) })) };
    const rest = groups.r.find((x) => x.g._rest);
    if (rest) this._restCalc(groups, rest, rest.g.entity ? this._num(rest.g.entity) : undefined);
    let soc = null, bp = null;
    if (b) { soc = this._num(b.soc);
      if (b.entity) bp = this._num(b.entity) * (b.invert ? -1 : 1);
      else if (b.charge || b.discharge) bp = (this._num(b.discharge) || 0) - (this._num(b.charge) || 0); }
    const sig = JSON.stringify([groups.l.map((x) => [x.tot, x.ph]), groups.r.map((x) => [x.tot, x.ph]), soc, bp, c.title, this._page, this._ovExtra(), c.price && c.price.entity && this._hass.states[c.price.entity] ? this._hass.states[c.price.entity].state : null, this._page === "list" ? Object.values(this._hh || {}).map((h) => h.v ? h.v.length : 0) : 0, this._page === "today" ? Object.values(this._stats || {}).map((x) => x.v) : 0]);
    if (sig === this._sig) return; this._sig = sig;
    this._el.title.textContent = c.title || "";
    const hasE = [...c.left, ...c.right].some((g) => g.energy || g.energy_import) || (c.battery && c.battery.energy_charge);
    const pages = Array.isArray(c.pages) && c.pages.length ? c.pages : ["ring", "list", "overview", ...(hasE ? ["today"] : [])];
    if (!this._page) { let v = null; try { v = localStorage.getItem("thef-ring-page"); } catch (_) {} this._page = pages.includes(v) ? v : (c.page && pages.includes(c.page) ? c.page : pages[0]); }
    if (!pages.includes(this._page)) this._page = pages[0];
    this._el.pg.hidden = pages.length < 2;
    this._el.pg.querySelectorAll("span").forEach((sp) => { sp.hidden = !pages.includes(sp.dataset.p); sp.classList.toggle("sel", sp.dataset.p === this._page); });
    // own title per page: page_titles: { ring: ..., list: ..., overview: ... }; falls back to title
    const pt = c.page_titles || {};
    this._el.title.textContent = pt[this._page] != null ? pt[this._page] : this._page === "today" ? this._t("today_total") : (c.title || "");   // today: always say what the numbers are
    if (c.title_color) this._el.title.style.setProperty("--thef-title", c.title_color);
    this._el.pg.querySelectorAll("span").forEach((sp) => { sp.title = pt[sp.dataset.p] || sp.dataset.p; });
    this._el.stage.hidden = this._page !== "ring"; this._el.ov.hidden = !["overview", "today"].includes(this._page); this._el.ls.hidden = this._page !== "list";
    // price next to "Charts" (bottom right) unless price.position: top or there are no charts
    const pcs = c.price && c.price.entity && this._hass.states[c.price.entity];
    this._pBot = !!(pcs && c.price.show !== false && c.price.position !== "top" && this._chartTabs().length);
    this._el.pfoot.hidden = !this._pBot; if (this._pBot) this._el.pfoot.innerHTML = this._priceHtml(pcs);
    this._el.pfoot.classList.toggle("open", !!(this._pBot && this._pOpen)); this._el.ppan.hidden = !(this._pBot && this._pOpen);
    if (this._pBot && this._pOpen) this._el.ppan.innerHTML = this._pricePanel();
    if (this._page === "overview") { this._eMode = false; this._el.ov.classList.remove("static"); this._renderOv(groups, soc, bp); return; }
    if (this._page === "today") { this._renderToday(groups, soc); return; }
    // no home tile but rest has its own total (rest.entity): the ring and list pages show that total as "Home total"
    if (rest && rest.g.entity && !groups.r.some((x) => x.g._home)) {
      const rc = c.rest || {};
      const inv = c.inverter || {}, hph = rc.phases || inv.phases;   // phases: own list, else the inverter output phases
      const hg = { name: rc.total_name || this._t("home_total"), entity: rest.g.entity, phases: hph, max: rc.max || inv.max, icon: rc.total_icon || "mdi:home", color: rc.total_color || rc.color || DEFAULT_COLORS.home, _home: true };
      groups.r.unshift({ g: hg, ...this._group(hg) });
    }
    if (this._page === "list") { this._renderList(groups, soc, bp); return; }
    const CX = 200, CY = 145, R0 = 178, GAP = 8, SPAN = 47, SEP = 8;
    let svg = "";
    // battery ring
    const RR = 83, circ = 2 * Math.PI * RR, alarm = b && b.soc_alarm != null ? Number(b.soc_alarm) : 15;
    const bc = b && b.color || (soc != null && soc < alarm ? "#ff6b5e" : "#34c759");
    svg += `<circle cx="${CX}" cy="${CY}" r="${RR}" class="trk t" style="--tc:${bc}" stroke-width="10"/>`;
    if (soc != null) svg += `<circle cx="${CX}" cy="${CY}" r="${RR}" fill="none" stroke="${bc}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(circ * Math.min(100, Math.max(0, soc)) / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${CX} ${CY})" style="transition: stroke-dasharray .6s"/>`;
    // side arcs
    const labs = [];
    for (const side of ["l", "r"]) {
      const hasHome = groups.r.some((y) => y.g._home), onL = (x) => hasHome ? !x.g._home : groups.l.includes(x);   // with Home total: all sources (grid, solar) left, home right
      const list = this._pick(groups).filter((x) => (side === "l") === onL(x)).slice(0, 3), n = list.length, sgn = side === "l" ? -1 : 1;
      if (!n) continue;
      const seg = (2 * SPAN - SEP * (n - 1)) / n;
      list.forEach((x, i) => {
        const top = SPAN - i * (seg + SEP), bot = top - seg, color = x.g.color || ["#5ac8fa", "#ffcc00", "#bf5af2"][i] ;
        const exp = x.g.export_color && (x.tot || 0) < 0, col = exp ? x.g.export_color : color;
        const lines = x.ph.length ? x.ph : [x.tot];
        const max = Number(x.g.max) > 0 ? Number(x.g.max) : c.max_power, pmax = max / lines.length;
        // fill from the end nearest the middle outward
        const fromTop = n > 1 && i === 0 ? false : n > 1;   // top group grows upward from its lower end, others downward
        lines.forEach((v, k) => {
          const r = R0 + (side === "l" ? lines.length - 1 - k : k) * GAP, f = Math.min(1, Math.abs(v || 0) / pmax);
          const tcol = x.g.export_color && (v || 0) < 0 ? x.g.export_color : color;
          svg += `<path class="trk t" style="--tc:${tcol}" stroke-width="5.5" d="${this._arc(CX, CY, r, bot, top, sgn)}"/>`;
          if (f > 0.004) { const a1 = fromTop ? top : bot, a2 = fromTop ? top - seg * f : bot + seg * f;
            const pc = x.g.export_color && (v || 0) < 0 ? x.g.export_color : color;
            svg += `<path class="val" stroke="${pc}" stroke-width="5.5" d="${this._arc(CX, CY, r, a1, a2, sgn)}"/>`; }
        });
        if (lines.length > 1) { const a = (fromTop ? top : bot) * Math.PI / 180;
          const rm = R0 + GAP * (lines.length - 1) / 2, ex = CX + sgn * rm * Math.cos(a), ey = CY - rm * Math.sin(a) + (fromTop ? -7 : 13);
          lines.forEach((_, k) => { svg += `<text class="ph" x="${(ex + (k - (lines.length - 1) / 2) * 9).toFixed(1)}" y="${ey.toFixed(1)}" text-anchor="middle">${k + 1}</text>`; }); }
        const mid = (top + bot) / 2 * Math.PI / 180;
        labs.push({ side, x: CX + sgn * (R0 * Math.cos(mid) - 12), y: CY - (n > 1 ? 140 : 0) * Math.sin(mid), x0: x, col: color, exp });
      });
    }
    this._el.svg.innerHTML = svg;
    this._el.stage.querySelectorAll(".lab").forEach((e) => e.remove());
    for (const L of labs) {
      const g = L.x0.g, el = document.createElement("div");
      el.className = "lab " + L.side;
      el.style.setProperty("--c", L.col);
      el.style.top = (L.y / 290 * 100) + "%";
      if (L.side === "l") el.style.left = (L.x / 400 * 100) + "%"; else el.style.right = ((400 - L.x) / 400 * 100) + "%";
      const sub = g.export_color || g.direction ? ((L.x0.tot || 0) < 0 ? (g.export_name || "teruglevering") : (g.import_name || "afname")) : "";
      const tv = L.x0.tot || 0, dir = (g.export_color || g.direction) && Math.abs(tv) > 20;
      // arrow points towards the battery/home when importing, away when exporting
      const toMid = tv > 0, arr = dir ? (L.side === "l" ? (toMid ? "mdi:arrow-right-bold" : "mdi:arrow-left-bold") : (toMid ? "mdi:arrow-left-bold" : "mdi:arrow-right-bold")) : "";
      el.title = [g.name, dir ? sub : ""].filter(Boolean).join(" · ");
      const ic = `<ha-icon class="gi" icon="${g.icon || "mdi:flash"}"></ha-icon>`, ai = arr ? `<ha-icon class="ai" icon="${arr}"></ha-icon>` : "";
      el.innerHTML = `<div class="ar">${ai}</div><div class="row">${L.side === "l" ? ic : ""}<span class="v">${this._fmtHtml(L.x0.tot)}</span>${L.side === "r" ? ic : ""}</div>`;
      el.style.setProperty("--a", L.exp ? (g.export_color || L.col) : L.col);
      el.addEventListener("click", () => this._open(g));
      this._el.stage.appendChild(el);
    }
    this._centre(this._el.mid, soc, bp);
  }

  _centre(m, soc, bp) {
    const b = this._config.battery || {};
    m.querySelector(".mh ha-icon").setAttribute("icon", b.icon || (bp != null && bp < -10 ? "mdi:battery-charging" : "mdi:battery"));
    m.querySelector(".mh span").textContent = b.name || "Accu";
    m.querySelector(".soc").innerHTML = soc == null ? "–" : `${Math.round(soc)}<span class="u">%</span>`;
    const ve = b.voltage && this._hass.states[b.voltage], loc = this._hass.language || "en";
    const vt = ve && !isNaN(parseFloat(ve.state)) ? parseFloat(ve.state).toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "<span class='u'> V</span>" : "";
    // charging positive, discharging negative (like Victron)
    const pw = bp == null ? "" : (bp > 10 ? "−" : "") + this._fmtHtml(bp);
    m.querySelector(".s").innerHTML = [vt, pw].filter(Boolean).join(" ");
    m.title = bp == null ? "" : bp < -10 ? (b.charging_name || "laden") : bp > 10 ? (b.discharging_name || "ontladen") : (b.idle_name || "rust");
  }
  _hist(id) {   // last hour of a power sensor, for the sparklines
    if (!id) return null;
    this._hh = this._hh || {}; const c0 = this._hh[id];
    if (!c0 || Date.now() - c0.t > 120000) {
      this._hh[id] = { t: Date.now(), v: c0 ? c0.v : null };
      const start = new Date(Date.now() - 3600000).toISOString();
      this._hass.callWS({ type: "history/history_during_period", start_time: start, entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false })
        .then((res) => { const arr = (res && res[id]) || []; let t = Date.parse(start) / 1000;
          this._hh[id].v = arr.map((p) => { if (p.lu != null) t = p.lu; else if (p.lc != null) t = p.lc; return [t, parseFloat(p.s)]; }).filter((p) => !isNaN(p[1]));
          this._sig = null; this._render(); }).catch(() => {});
    }
    return this._hh[id].v;
  }
  _spark(pts, color, inv) {
    if (!pts || pts.length < 2) return "";
    const now = Date.now() / 1000, t0 = now - 3600, k0 = pts.findIndex((p) => p[0] >= t0);
    pts = k0 > 0 ? pts.slice(k0 - 1) : k0 < 0 ? pts.slice(-1) : pts;   // keep only the last hour (plus the value at its start)
    if (pts.length < 2) pts = [[t0, pts[0][1]], [now, pts[0][1]]];
    const vals = pts.map((p) => (inv ? -p[1] : p[1]));
    let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); if (hi - lo < 1) hi = lo + 1;
    const X = (t) => ((Math.max(t0, t) - t0) / 3600 * 100).toFixed(1), Y = (v) => (22 - (v - lo) / (hi - lo) * 20).toFixed(1);
    let d = ""; pts.forEach((p, i) => { const y = Y(vals[i]); d += (i ? `H${X(p[0])}V${y}` : `M${X(p[0])},${y}`); }); d += `H100`;
    return `<line x1="0" x2="100" y1="${Y(0)}" y2="${Y(0)}" stroke="currentColor" stroke-opacity=".3" stroke-dasharray="1 2" vector-effect="non-scaling-stroke"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  }
  _pick(groups) {   // groups shown on the ring and list pages: config "show" (names), else all left groups plus the first right one
    const c = this._config, all = [...groups.l, ...groups.r].filter((x) => x.g.type !== "meter");
    if (Array.isArray(c.show) && c.show.length) return c.show.map((n) => all.find((x) => x.g.name === n)).filter(Boolean);
    const home = groups.r.find((x) => x.g._home), srcR = groups.r.filter((x) => x.g.type !== "meter" && (x.g.source || x.g.position === "top"));
    if (home) return [...groups.l.filter((x) => x.g.type !== "meter" && !x.g.load && x.g.ac !== "in").slice(0, 3), ...srcR.slice(0, 2), home];
    return [...groups.l.filter((x) => x.g.type !== "meter" && !x.g.load).slice(0, 3), ...groups.r.filter((x) => x.g.type !== "meter").slice(0, 1)];
  }
  _restCalc(gs, rest, baseTot) {   // rest = home total minus all listed consumers; baseTot given = hidden home total (rest.entity)
    const base = baseTot !== undefined ? null : gs.r.find((x) => !x.g._rest && (rest.g.of ? x.g.name === rest.g.of : true));
    const tot = baseTot !== undefined ? baseTot : base ? base.tot : null;
    const loads = [...gs.r.filter((x) => x !== base && x !== rest), ...gs.l.filter((x) => x.g.load || x.g.ac === "in")]
      .filter((x) => x.g.type !== "meter" && !x.g.source && x.g.position !== "top" && x.g.in_rest !== false && (x.g.ac !== "in" || x.g.in_rest === true));   // sources (solar on AC-out) are not consumers
    rest.tot = tot != null ? Math.max(0, tot - loads.reduce((a, x) => a + Math.max(0, x.tot || 0), 0)) : null;
  }
  _renderToday(groups, soc) {   // same schematic, but kWh since midnight (from the long-term statistics)
    const c = this._config, st = (id) => (id ? this._stat(id) : null), b = c.battery || {};
    const tg = (x) => {
      const g = x.g;
      if (g.type === "meter") return { ...x };
      if (g.energy_import || g.energy_export) {
        const i = st(g.energy_import) || 0, e = st(g.energy_export) || 0;
        return { ...x, tot: i, ph: [], w: 1.5, src: true, sub: e > 0 ? `<ha-icon class="ar" icon="mdi:arrow-left"></ha-icon>` + this._fmtHtml(e) : "", imp: i, exp: e };
      }
      // say what the kWh is: produced by a source (solar), used by a consumer
      const isSrc = g.source || g.position === "top" || (groups.l.includes(x) && !g.load && g.ac !== "in");
      return { ...x, tot: g._rest ? null : (g.energy ? st(g.energy) : null), ph: [], w: 1, src: !!isSrc };
    };
    this._eMode = true;
    const tgs = { l: groups.l.map(tg), r: groups.r.map(tg) };
    const rest = tgs.r.find((x) => x.g._rest);

    const ch = st(b.energy_charge), di = st(b.energy_discharge);
    this._bE = ch != null || di != null ? { c: ch || 0, d: di || 0 } : null;
    // home without its own kWh meter: energy balance = grid import − export + other sources + battery discharge − charge
    const grid = tgs.l.find((x) => x.imp != null), srcs = [...tgs.l, ...tgs.r].filter((x) => x !== grid && x.src && x.g.type !== "meter");
    const bal = grid ? grid.imp - grid.exp + srcs.reduce((a, x) => a + (x.tot || 0), 0) + (this._bE ? this._bE.d - this._bE.c : 0) : null;
    const home = rest && rest.g.entity ? null : tgs.r.find((x) => !x.g._rest);
    if (home && home.tot == null && !home.g.energy) home.tot = bal;
    if (rest) this._restCalc(tgs, rest, rest.g.entity ? (rest.g.energy ? st(rest.g.energy) : bal) : undefined);
    this._el.ov.classList.add("static");
    this._renderOv(tgs, soc, this._bE ? this._bE.d - this._bE.c : null);
    this._eMode = false;
  }
  _renderList(groups, soc, bp) {
    const c = this._config, b = c.battery || {}, alarm = b.soc_alarm != null ? Number(b.soc_alarm) : 15;
    const bc = b.color || (soc != null && soc < alarm ? "#ff6b5e" : "#34c759"), RR = 86, circ = 2 * Math.PI * RR;
    this._el.lsvg.innerHTML = `<circle cx="100" cy="100" r="${RR}" class="trk t" style="--tc:${bc}" stroke-width="10"/>` +
      (soc != null ? `<circle cx="100" cy="100" r="${RR}" fill="none" stroke="${bc}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(circ * Math.min(100, Math.max(0, soc)) / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 100 100)"/>` : "");
    this._centre(this._el.mid2, soc, bp);
    // which rows: config list (names) or all left groups plus the first right one
    const rows = this._pick(groups).slice(0, 5).sort((a, b) => (b.g.position === "top" || !!b.g.source) - (a.g.position === "top" || !!a.g.source));   // "top" / source items (solar) first
    const box = this._el.rows; box.innerHTML = "";
    for (const x of rows) {
      const g = x.g, color = g.color || "#5ac8fa", tv = x.tot || 0, exp = g.export_color && tv < 0, col = exp ? g.export_color : color;
      const dir = (g.export_color || g.direction) && Math.abs(tv) > 20, isL = groups.l.includes(x);
      const arr = dir ? ((isL ? tv > 0 : tv < 0) ? "mdi:arrow-right-bold" : "mdi:arrow-left-bold") : "";
      const el = document.createElement("div"); el.className = "rw"; el.style.setProperty("--c", color); el.style.setProperty("--a", col);
      const max = Number(g.max) > 0 ? Number(g.max) : c.max_power, pmax = max / Math.max(1, x.ph.length);
      const pb = x.ph.length ? `<div class="pb" style="grid-template-columns:repeat(${x.ph.length},1fr)">${x.ph.map((v, k) => `<div>L${k + 1}<i><b style="width:${(Math.min(1, Math.abs(v || 0) / pmax) * 100).toFixed(1)}%;--pc:${g.export_color && (v || 0) < 0 ? g.export_color : color}"></b></i></div>`).join("")}</div>` : "";
      const sp = this._spark(this._hist(g.entity), col, g.invert);
      el.innerHTML = `<div class="rh"><ha-icon icon="${g.icon || "mdi:flash"}"></ha-icon><span></span></div><div class="rv">${arr ? `<ha-icon icon="${arr}"></ha-icon>` : ""}<span class="v">${this._fmtHtml(x.tot)}</span>${sp ? `<svg class="sp" viewBox="0 0 100 24" preserveAspectRatio="none">${sp}</svg>` : ""}</div>${pb}`;
      el.querySelector(".rh span").textContent = g.name || "";
      el.title = g.name || ""; el.addEventListener("click", () => this._open(g));
      box.appendChild(el);
    }
  }
  _chartTabs() {   // chart: { tabs: [price, solar, battery, home], price: {entity, attribute, start_key, value_key}, hours }
    const c = this._config, ch = c.chart; if (!ch) return [];
    const all = [...c.left, ...c.right].filter((g) => g.type !== "meter");
    const solar = all.find((g) => g.position === "top") || all.find((g) => /solar|zon/i.test(g.name || ""));
    const home = c.right.find((g) => g.type !== "meter" && g.entity), b = c.battery, tabs = [];
    const grid = c.left.find((g) => g.type !== "meter" && g.position !== "top" && !g.load && g.entity);
    for (const t of ch.tabs || ["price", "solar", "battery", "home", "grid"]) {
      if (t === "grid" && grid) tabs.push({ id: "grid", name: grid.name || "Net", ent: grid.entity, color: grid.color || "#ff6b5e" });
      if (t === "price" && ch.price && ch.price.entity) tabs.push({ id: "price", name: this._t("price") });
      if (t === "solar" && solar && solar.entity) tabs.push({ id: "solar", name: solar.name || this._t("solar"), ent: solar.entity, color: solar.color || "#ffb300" });
      if (t === "battery" && b && b.soc) tabs.push({ id: "battery", name: this._t("soc"), ent: b.soc, color: "#34c759", unit: "%", max: 100 });
      if (t === "home" && home) tabs.push({ id: "home", name: this._t("consumption"), ent: home.entity, color: home.color || "#5ac8fa" });
    }
    return tabs;
  }
  _meter(g) {   // gas / water style tile: state with its own unit, plus today's usage
    const hs = this._hass.states, e = g.entity && hs[g.entity], dec = g.decimals != null ? g.decimals : 2;
    const fmt = (st, unit) => { const n = parseFloat(st); return isNaN(n) ? st : n.toLocaleString(this._hass.language || "en", { maximumFractionDigits: dec }) + `<span class="u">\u00a0${unit || ""}</span>`; };
    let td = g.today && hs[g.today] ? { v: hs[g.today].state, u: hs[g.today].attributes.unit_of_measurement } : null;
    if (!td && g.total) {
      this._tot = this._tot || {}; const c0 = this._tot[g.total];
      if (!c0 || Date.now() - c0.t > 300000) {
        this._tot[g.total] = { t: Date.now(), v: c0 ? c0.v : null };
        this._hass.callWS({ type: "recorder/statistic_during_period", statistic_id: g.total, calendar: { period: "day" }, types: ["change"] })
          .then((x) => { this._tot[g.total].v = x.change; this._sig = null; this._render(); }).catch(() => {});
      }
      const te = hs[g.total], v = this._tot[g.total].v;
      if (v != null) td = { v, u: te ? te.attributes.unit_of_measurement : "" };
    }
    const tn = g.today_name || "vandaag";
    const main = e ? fmt(e.state, e.attributes.unit_of_measurement) : td ? fmt(td.v, td.u) : "–";
    const sub = e && td ? tn + " " + fmt(td.v, td.u) : "";
    const on = e ? Math.abs(parseFloat(e.state) || 0) > 0 : td ? Math.abs(parseFloat(td.v) || 0) > 0 : false;
    return { main, sub, on };
  }
  _ovExtra() {
    const c = this._config, st = (id) => { const e = id && this._hass.states[id]; return e ? e.state : null; };
    return [...[].concat(c.left, c.right).filter((g) => g && g.type === "meter").map((g) => JSON.stringify(this._meter(g))), st(c.inverter && c.inverter.entity), st(c.battery && c.battery.voltage), st(c.battery && c.battery.current), st(c.battery && c.battery.temperature)];
  }
  _tile(key, { x, y, w, h, color, on, icon, name, value, txt, phases, sub, cls, cfg }) {
    this._tiles = this._tiles || {};
    let t = this._tiles[key];
    if (!t) { t = document.createElement("div"); t.addEventListener("click", () => this._open(t._cfg)); this._tiles[key] = t; this._el.ov.appendChild(t); }
    t._cfg = cfg; t.className = "tile " + (cls || "") + (on ? " on" : "");
    const HH = this._ovH || 250; Object.assign(t.style, { left: x / 4 + "%", top: y / HH * 100 + "%", width: w / 4 + "%", height: h / HH * 100 + "%" });
    t.style.setProperty("--c", color);
    // phases as small bars (like the list page); the value shows as tooltip
    const g0 = cfg || {}, pmax = (Number(g0.max) > 0 ? Number(g0.max) : this._config.max_power) / Math.max(1, (phases || []).length);
    const ph = (phases || []).map((v, i) => `<div title="L${i + 1}: ${Math.round(v || 0)} W">L${i + 1}<i><b style="width:${(Math.min(1, Math.abs(v || 0) / pmax) * 100).toFixed(1)}%;--pc:${g0.export_color && (v || 0) < 0 ? g0.export_color : (g0.color || color)}"></b></i></div>`).join("");
    t.innerHTML = `<div class="th"><ha-icon icon="${icon}"></ha-icon><span></span></div><div class="tv ${txt ? "txt" : ""}"></div>${ph ? `<div class="pb tb">${ph}</div>` : ""}${[].concat(sub || []).filter(Boolean).map((_, i) => `<div class="ts${i ? " t2" : ""}"></div>`).join("")}`;
    t.querySelector(".th span").textContent = name || "";
    if (txt) { const tv = t.querySelector(".tv"); tv.textContent = value == null ? (key === "inv" ? "" : "–") : value; if (!tv.textContent) tv.style.display = "none"; } else t.querySelector(".tv").innerHTML = value;
    const ts = t.querySelectorAll(".ts"); [].concat(sub || []).filter(Boolean).forEach((v, i) => (ts[i].innerHTML = v));
    t._seen = true;
    return t;
  }
  _renderOv(groups, soc, bp) {
    const c = this._config, b = c.battery, inv = c.inverter || {}, minP = Number(c.min_power) >= 0 ? Number(c.min_power) : 20, hs = this._hass.states, thr = (g) => (g && Number(g.min_power) >= 0 ? Number(g.min_power) : minP);
    Object.values(this._tiles || {}).forEach((t) => (t._seen = false));
    const W = 400, CW = 106, MW = 112, MX = (W - MW) / 2, G = 12, UMIN = 58, LG = 26;
    // tiles with position: top go above the inverter in the middle column
    // Victron layout: as soon as an item says ac: out1 / out2, everything is drawn by its AC connection
    const vic = [...groups.l, ...groups.r].some((x) => x.g.ac === "out1" || x.g.ac === "out2");
    let vicPos = null;
    const isOut = (x, n) => vic && (x.g.ac === n || (n === "out1" && !x.g.ac && groups.r.includes(x)));
    const topL = vic ? [] : groups.l.filter((x) => x.g.position === "top").slice(0, 1);
    const sides = { l: groups.l.filter((x) => x.g.position !== "top").slice(0, 5), r: groups.r.filter((x) => x.g.position !== "top").slice(0, 5) };
    // home branch: home stays top right, all other consumers go to a grid underneath, fed from home
    // devices with ac: in sit before the inverter (on the grid side): they hang on the grid line, left under the grid tile
    const isIn = (x) => x.g.ac === "in";
    const acIn = [...groups.r.filter(isIn), ...groups.l.filter((x) => isIn(x) && x.g.position !== "top")];
    sides.l = groups.l.filter((x) => x.g.position !== "top" && !isIn(x)).concat(groups.r.filter(isIn)).slice(0, 5);
    const allR = groups.r.filter((x) => x.g.position !== "top" && !isIn(x)), br = c.branch !== false && !(c.rest && c.rest.entity) && allR.length > 1;
    const devs = br && !vic ? allR.slice(1, 10) : [];
    if (br && !vic) sides.r = allR.slice(0, 1); else sides.r = allR.slice(0, 5);
    if (vic) {   // left: grid + AC-in; right: AC-out 1 then AC-out 2 (sources like solar included)
      const all = [...groups.l, ...groups.r].filter((x) => x.g.type !== "meter" || groups.l.includes(x));
      sides.l = all.filter((x) => groups.l.includes(x) && !x.g.ac || x.g.ac === "in").slice(0, 6);
      const outs = [...all.filter((x) => isOut(x, "out1")), ...all.filter((x) => isOut(x, "out2"))].slice(0, 10);
      // AC-out 2 at the top right (own branch from the right of the inverter); AC-out 1 fills both columns from the bottom up
      const o2s = outs.filter((x) => isOut(x, "out2")), o1s = outs.filter((x) => isOut(x, "out1"));
      o1s.sort((a, b) => (a.g.source || a.g.position === "top" ? 1 : 0) - (b.g.source || b.g.position === "top" ? 1 : 0));   // sources end up highest
      const u = (x) => (x.ph && x.ph.length ? 2 : 1);   // rows on the grid
      const L1 = [], R1 = []; let ul = sides.l.reduce((a, x) => a + u(x), 0), ur = o2s.reduce((a, x) => a + u(x), 0);
      for (const x of o1s) { if (c.split === false || ur <= ul) { R1.push(x); ur += u(x); } else { L1.push(x); ul += u(x); } }
      vicPos = { lTop: sides.l.slice(), rTop: o2s, lBot: L1, rBot: R1 };
      sides.l = [...sides.l, ...L1.slice().reverse()];
      sides.r = [...o2s, ...R1.slice().reverse()];
      devs.length = 0;
    }
    const wt = (x) => x.w ? x.w : x.g.size === "small" ? 1 : x.g.size === "large" ? 2 : x.ph.length ? 1.7 : 1;
    const units = (L) => L.reduce((a, x) => a + wt(x), 0);
    const need = (L) => L.length ? units(L) * UMIN + G * (L.length - 1) : 0;
    const pc = c.price && c.price.entity && this._hass.states[c.price.entity], hPr = pc && c.price.show !== false && !this._eMode && !this._pBot ? 30 : 0, PG = hPr ? 10 : 0;
    // middle column; compact when the sides are short (few devices), so the card shrinks with them
    const needSides = Math.max(need(sides.l), need(sides.r)), cmp = needSides < 300;
    const invPh = (inv.phases || []).map((id) => this._num(id)), hTop = topL.length ? (cmp ? 50 : 58) : 0, hInv = (cmp ? 60 : 74) - (inv.show_state === false ? 22 : 0) + (invPh.length && !this._eMode ? 40 : 0) + (inv.model ? 12 : 0) + (vic ? 30 : 0), hBat = b ? (cmp ? 88 : 112) + (b.model ? 16 : 0) : 0, LG2 = cmp ? 18 : LG;
    const needMid = hPr + PG + hTop + hInv + hBat + (hTop ? LG2 : 0) + (hBat ? LG2 : 0) + (vic ? 20 : 0);
    let topH = Math.round(Math.max(cmp ? 200 : 240, vicPos ? 0 : needSides, needMid));   // Victron layout: rows counted on the grid below
    // Victron layout: both columns on one row grid, so left and right tiles line up (a tile with phase bars takes two rows)
    const SP = UMIN + G, sl = (x) => (x.ph && x.ph.length ? 2 : 1);
    if (vicPos) { const ns = Math.max(...[[...vicPos.lTop, ...vicPos.lBot], [...vicPos.rTop, ...vicPos.rBot]].map((L) => L.reduce((a, x) => a + sl(x), 0)));
      topH = Math.max(Math.ceil((Math.max(topH, ns * SP - G) + G) / SP), ns) * SP - G; }
    const rows = Math.ceil(devs.length / 3), RH = UMIN, gridTop = topH + 30;
    const H = devs.length ? gridTop + rows * RH + (rows - 1) * 16 : topH;
    if (this._ovH !== H) { this._ovH = H; this._el.ov.style.aspectRatio = `400 / ${H}`; this._el.ovsvg.setAttribute("viewBox", `0 0 400 ${H}`); }
    // one unit height for both columns, so tiles of the same kind are the same size left and right
    const uh = Math.min(UMIN * 1.3, ...["l", "r"].filter((k) => sides[k].length).map((k) => (topH - G * (sides[k].length - 1)) / units(sides[k])));
    const paths = [];
    // middle column: [top] - inverter (centred) - battery
    // battery above the inverter (Victron layout, or battery_position: top): the inverter sits lower, leaving room for the AC lines
    const batTop = b && (c.battery_position ? c.battery_position === "top" : vic);
    const invY = hPr + PG + (hTop ? hTop + LG2 : 0) + (batTop ? hBat + LG2 : 0);   // middle column stacked from the top
    const pY = inv.model ? 60 : 48;   // anchored below the title/model (phone fonts are relatively larger, so not measured from the bars)   // AC-in/out 2 ports: in the band between model text and phase bars
    const inT = { x: MX, y: invY, w: MW, h: hInv }, baT = batTop ? { x: MX, y: hPr + PG + (hTop ? hTop + LG2 : 0), w: MW, h: hBat } : { x: MX, y: invY + hInv + LG2, w: MW, h: hBat };
    const toT = { x: MX, y: Math.max(0, invY - LG2 - hTop), w: MW, h: hTop };
    const col = (list) => { const wts = list.map(wt), U = wts.reduce((a, v) => a + v, 0), n = list.length, tot = uh * U + G * (n - 1);
      let y = c.align === "center" ? Math.max(0, Math.min(H - tot, inT.y + inT.h / 2 - tot / 2)) : 0;   // default: both columns start at the top
      return wts.map((w) => { const r = { y, h: uh * w, sm: w < 1.5 }; y += uh * w + G; return r; }); };
    const orth = (x1, y1, x2, y2, mx) => { if (Math.abs(y1 - y2) < 1) return `M${x1},${y1}H${x2}`; mx = mx == null ? (x1 + x2) / 2 : mx; const r = Math.min(8, Math.abs(y2 - y1) / 2, Math.abs(mx - x1)), sy = y2 > y1 ? 1 : -1, sx = x2 > x1 ? 1 : -1;
      return `M${x1},${y1}H${mx - sx * r}Q${mx},${y1} ${mx},${y1 + sy * r}V${y2 - sy * r}Q${mx},${y2} ${mx + sx * r},${y2}H${x2}`; };
    const bus = []; let yo1 = [], yo2 = [], busL = null; const outBus = [];
    for (const side of ["l", "r"]) {
      const list = sides[side], ys = []; let net = 0, busX = 0;
      let pos = col(list);
      if (vicPos) {   // top group from the top, AC-out 1 group from the bottom up
        const top = side === "l" ? vicPos.lTop : vicPos.rTop, bot = side === "l" ? vicPos.lBot : vicPos.rBot, m = new Map();
        let y = 0; for (const x of top) { const h = sl(x) * SP - G; m.set(x, { y, h, sm: sl(x) < 2 }); y += h + G; }
        if (vicPos.rTop.length) { y = H + G; for (const x of bot) { const h = sl(x) * SP - G; y -= h + G; m.set(x, { y, h, sm: true }); } }   // AC-out 2 at the top: AC-out 1 from the bottom up
        else for (const x of bot.slice().reverse()) { const h = sl(x) * SP - G; m.set(x, { y, h, sm: true }); y += h + G; }   // no AC-out 2: everything from the top, no gaps
        pos = list.map((x) => m.get(x));
      }
      list.forEach((x, i) => {
        const g = x.g, p = pos[i], tx = side === "l" ? 0 : W - CW, color = g.color || ["#5ac8fa", "#ffcc00", "#bf5af2"][i];
        if (g.type === "meter") { const m = this._meter(g);
          this._tile(side + i, { x: tx, y: p.y, w: CW, h: p.h, color, on: m.on, icon: g.icon || "mdi:gauge", name: g.name, value: m.main, sub: p.sm ? "" : m.sub, cls: (p.sm ? "sm " : "") + "meter", cfg: g });
          if (p.sm && m.sub) { const t = this._tiles[side + i]; t.querySelector(".th span").textContent = (g.name || "") + " · " + m.sub.replace(/<[^>]+>/g, "").replace(/\u00a0/g, " "); }
          return; }
        const exp = g.export_color && (x.tot || 0) < 0, cc = exp ? g.export_color : color, on = Math.abs(x.tot || 0) > thr(g);
        const sub = g.export_color ? ((x.tot || 0) < -thr(g) ? (g.export_name || "teruglevering") : (x.tot || 0) > thr(g) ? (g.import_name || "afname") : "") : "";
        this._tile(side + i, { x: tx, y: p.y, w: CW, h: p.h, color: cc, on, icon: g.icon || "mdi:flash", name: g.name, value: (x.src != null ? `<ha-icon class="ar" icon="mdi:arrow-${(side === "l") === x.src ? "right" : "left"}"></ha-icon>` : "") + this._fmtHtml(x.tot), phases: x.ph.length ? x.ph : null, sub: x.sub != null ? x.sub : !x.ph.length && sub && !p.sm ? sub : "", cls: p.sm ? "sm" : "", cfg: g });
        const br = false;   // (old in-column home branch, replaced by the grid below)
        let ty = br && i === 0 ? p.y + Math.min(28, p.h / 3) : p.y + p.h / 2, ex = side === "l" ? tx + CW : tx, bx = side === "l" ? (ex + inT.x) / 2 + (vic ? 7 : 0) : br ? inT.x + MW + (ex - inT.x - MW) * 0.35 : (inT.x + MW + ex) / 2;
        // branch from the bus to the tile; sources flow towards the bus when positive, loads away from it
        const src = side === "l" ? !g.load && !isIn(x) : vic && (g.source || g.position === "top");   // left tiles are sources unless load / ac: in; right: sources like solar
        if (side === "l" && isIn(x) && list.length > 1) {   // before the inverter: fed from the grid tile, not from the inverter
          const gp = pos[0], gy = gp.y + gp.h / 2, rr3 = Math.min(6, Math.abs(ty - gy) / 2);
          const d = `M${ex},${gy}H${bx - rr3}Q${bx},${gy} ${bx},${gy + rr3}V${ty - rr3}Q${bx},${ty} ${bx - rr3},${ty}H${ex}`;
          paths.push({ d, color: cc, on, rev: (x.tot || 0) < 0, pw: Math.abs(x.tot || 0) });
          ys.push(ty); busX = bx; return;
        }
        const toBus = src ? (x.tot || 0) >= 0 : (x.tot || 0) < 0;
        // home branch: the first right tile (home) hangs on the inverter, all other right tiles hang under home
        if (false) {
          const hp = pos[0], hb = hp.y + hp.h - 14, bxx = tx - 9, rr2 = Math.min(6, Math.abs(ty - hb) / 2);
          const d = `M${tx},${hb}H${bxx + rr2}Q${bxx},${hb} ${bxx},${hb + rr2}V${ty - rr2}Q${bxx},${ty} ${bxx + rr2},${ty}H${tx}`;
          paths.push({ d, color: cc, on, rev: (x.tot || 0) < 0, pw: Math.abs(x.tot || 0) });
          ys.push(ty); busX = bxx; return;
        }
        if (vic && isOut(x, "out1")) {
          const two = false, hy = Math.min(inT.y + inT.h + (two ? 46 : 32), H - 4), icx = W / 2 + (two ? 10 : 0);
          const vx = side === "l" ? CW + (two ? 5 : 11) : W - CW - (two ? 5 : 11), r6 = 5;
          const sgnY = hy > ty ? 1 : -1, sgnX = side === "l" ? 1 : -1;
          const d = `M${ex},${ty}H${vx - sgnX * r6}Q${vx},${ty} ${vx},${ty + sgnY * r6}V${hy - sgnY * r6}Q${vx},${hy} ${vx + sgnX * r6},${hy}H${icx}V${inT.y + inT.h}`;
          const srcO = g.source || g.position === "top";
          paths.push({ d, color: cc, on, rev: srcO ? (x.tot || 0) < 0 : (x.tot || 0) >= 0, pw: Math.abs(x.tot || 0) });
          outBus.push({ side, two, vx, ty, hy, icx });
          return;
        }
        const o2 = vic && side === "r" && g.ac === "out2";
        if (o2) { bx = (inT.x + MW + ex) / 2 - 7; }
        const iyy = vic ? inT.y + pY : inT.y + inT.h / 2, ixx = side === "l" ? inT.x : inT.x + MW, sy = iyy > ty ? 1 : -1, sx = side === "l" ? 1 : -1, rr = Math.min(6, Math.abs(iyy - ty) / 2);
        if (vic) (o2 ? (yo2 = yo2.concat(ty, iyy)) : side === "r" ? (yo1 = yo1.concat(ty, iyy)) : null);
        // full route tile -> bus -> inverter, so the dots also run along the vertical bus
        const route = Math.abs(iyy - ty) < 1 ? `M${ex},${ty}H${ixx}` : `M${ex},${ty}H${bx - sx * rr}Q${bx},${ty} ${bx},${ty + sy * rr}V${iyy}H${ixx}`;
        paths.push({ d: route, color: cc, on, rev: !toBus, pw: Math.abs(x.tot || 0) });
        ys.push(ty); net += side === "l" ? (x.tot || 0) : -(x.tot || 0); busX = bx;
      });
      if (false) {
        const hp = pos[0], hb = hp.y + hp.h - 14, bxx = W - CW - 9;
        bus.push(`M${W - CW},${hb}H${bxx}V${Math.max(...ys)}`);
      } else if (vic && side === "r") {
        if (yo2.length) { const bx2 = (inT.x + MW + W - CW) / 2 - 7; bus.push(`M${bx2},${Math.min(...yo2)}V${Math.max(...yo2)}`); }
      } else if (list.length) {
        const iy = vic ? inT.y + pY : inT.y + inT.h / 2, ix = side === "l" ? inT.x : inT.x + MW;
        ys.push(iy); const y0 = Math.min(...ys), y1 = Math.max(...ys);
        bus.push(`M${busX},${y0}V${y1}`);
        if (side === "l") busL = { x: busX, y: y0 };
        // stub between bus and inverter carries the net flow of this side
        const into = side === "l" ? net >= 0 : net < 0;

      }
    }
    // current price chip at the top of the middle column
    if (hPr) {
      const prY = batTop ? 0 : (hTop ? toT.y : invY) - PG - hPr;
      let el = this._el.ov.querySelector(".prc");
      if (!el) { el = document.createElement("div"); el.className = "prc"; el.addEventListener("click", () => this._open({ entity: this._config.price.entity })); this._el.ov.appendChild(el); }
      const HH = this._ovH || 250; Object.assign(el.style, { left: MX / 4 + "%", width: MW / 4 + "%", top: Math.max(0, prY) / HH * 100 + "%", height: hPr / HH * 100 + "%" });
      el.innerHTML = this._priceHtml(pc);
    } else { const el = this._el.ov.querySelector(".prc"); if (el) el.remove(); }
    for (const x of topL) {
      const g = x.g, color = g.color || "#ffcc00", exp = g.export_color && (x.tot || 0) < 0, cc = exp ? g.export_color : color, on = Math.abs(x.tot || 0) > thr(g);
      this._tile("top", { ...toT, color: cc, on, icon: g.icon || "mdi:solar-power-variant", name: g.name, value: this._fmtHtml(x.tot), cls: "sm", cfg: g });
      const x0 = W / 2, y1 = toT.y + toT.h, y2 = inT.y;
      paths.push({ d: `M${x0},${y1}V${y2}`, color: cc, on, rev: (x.tot || 0) < 0, pw: Math.abs(x.tot || 0) });
    }
    // inverter
    const ist = inv.entity && inv.show_state !== false && hs[inv.entity], ival = ist ? (this._hass.formatEntityState ? this._hass.formatEntityState(ist) : ist.state) : null;
    this._tile("inv", { ...inT, color: inv.color || (vic ? "#3b8ed8" : "#8e8e93"), on: true, icon: inv.icon || "mdi:sine-wave", name: inv.name || "Omvormer", value: ival, txt: true, cls: "inv" + (invPh.length && !this._eMode ? " ph" : ""), phases: invPh.length && !this._eMode ? invPh : null, cfg: { entity: inv.entity, navigate: inv.navigate, max: inv.max || 13500, color: inv.phase_color || "#5ac8fa" } });
    { const t = this._tiles.inv;   // optional model line and own image (e.g. a logo file in /local)
      if (inv.model) { const m = document.createElement("div"); m.className = "model"; m.textContent = inv.model; t.querySelector(".tv").after(m); }
      if (inv.image) { const im = document.createElement("img"); im.className = "logo"; im.src = inv.image; im.alt = ""; t.querySelector(".th").prepend(im); t.querySelector(".th ha-icon").style.display = "none"; } }
    // battery
    if (b) {
      const alarm = b.soc_alarm != null ? Number(b.soc_alarm) : 15, bc = b.color || (soc != null && soc < alarm ? "#ff6b5e" : "#34c759");
      const st = bp == null ? "" : bp < -10 ? (b.charging_name || "laden") : bp > 10 ? (b.discharging_name || "ontladen") : (b.idle_name || "rust");
      const f = (id, u, dec) => { const e = id && hs[id]; if (!e || isNaN(parseFloat(e.state))) return null; return parseFloat(e.state).toLocaleString(this._hass.language || "en", { maximumFractionDigits: dec, minimumFractionDigits: dec }) + "<span class='u'>\u00a0" + u + "</span>"; };
      const bw = Math.abs(bp || 0) > 10 ? (bp > 0 ? "−" : "") + this._fmtHtml(bp) : "";
      let l1 = [bw, f(b.voltage, "V", 1)].filter(Boolean).join(" · "), l2 = [f(b.current, "A", 0), f(b.temperature, "°C", 0)].filter(Boolean).join(" · ");
      if (this._eMode && this._bE) { l1 = (b.charged_name || "geladen") + " " + this._fmtHtml(this._bE.c); l2 = (b.discharged_name || "ontladen") + " " + this._fmtHtml(this._bE.d); }
      const t = this._tile("bat", { ...baT, color: bc, on: true, icon: b.icon || "mdi:home-battery", name: b.name || "Accu", value: soc == null ? "–" : `${Math.round(soc)}<span class="u">%\u2002${this._eMode ? "" : st}</span>`,
        sub: [l1, l2], cls: "bat", cfg: b });
      t.style.setProperty("--soc", (soc == null ? 0 : Math.max(0, Math.min(100, soc))) + "%");
      if (b.model) { const m = document.createElement("div"); m.className = "model"; m.style.cssText = "text-align:left;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.25"; m.textContent = String(b.model).replace(/-/g, "\u2011"); t.querySelector(".tv").after(m); }   // brand/type, like the inverter
      const bT = b && Number(b.min_power) >= 0 ? Number(b.min_power) : 10, ch = (bp || 0) < -bT, on = Math.abs(bp || 0) > bT, x0 = W / 2, y1 = batTop ? inT.y : inT.y + inT.h, y2 = batTop ? baT.y + baT.h : baT.y;
      paths.push({ d: ch ? `M${x0},${y1}V${y2}` : `M${x0},${y2}V${y1}`, color: bc, on });
    }
    if (devs.length) {
      // home -> straight down from the bottom of the home tile to the first row; further rows via the gutter
      const hp = col(sides.r)[0], hcx = W - CW / 2, hb = hp.y + hp.h, gut = (MX + MW + W - CW) / 2, cols = [[0, CW], [MX, MW], [W - CW, CW]];
      const busY = (r) => gridTop + r * (RH + 16) - 9;
      bus.push(`M${hcx},${hb}V${busY(0)}`);
      if (rows > 1) bus.push(`M${gut},${busY(0)}V${busY(rows - 1)}`);
      for (let r = 0; r < rows; r++) { const n = Math.min(3, devs.length - r * 3), xs = cols.slice(0, n).map(([x, w]) => x + w / 2).concat(r ? [gut] : [hcx]);
        bus.push(`M${Math.min(...xs)},${busY(r)}H${Math.max(...xs)}`); }
      devs.forEach((x, k) => {
        const g = x.g, r = Math.floor(k / 3), [tx, tw] = cols[k % 3], ty = gridTop + r * (RH + 16), cx = tx + tw / 2;
        const color = g.color || "#8e8e93", on = Math.abs(x.tot || 0) > thr(g);
        this._tile("d" + k, { x: tx, y: ty, w: tw, h: RH, color, on, icon: g.icon || "mdi:flash", name: g.name, value: this._fmtHtml(x.tot), sub: "", cls: "sm", cfg: g });
        const d = r === 0 ? `M${hcx},${hb}V${busY(0)}H${cx}V${ty}` : `M${hcx},${hb}V${busY(0)}H${gut}V${busY(r)}H${cx}V${ty}`;
        paths.push({ d, color, on, rev: (x.tot || 0) < 0, pw: Math.abs(x.tot || 0) });
      });
    }
    Object.entries(this._tiles).forEach(([k, t]) => { if (!t._seen) { t.remove(); delete this._tiles[k]; } });
    for (const two of [false, true]) {
      const ob = outBus.filter((o) => o.two === two); if (!ob.length) continue;
      const hy = ob[0].hy, icx = ob[0].icx, xs = ob.map((o) => o.vx).concat(icx);
      bus.push(`M${icx},${inT.y + inT.h}V${hy}`, `M${Math.min(...xs)},${hy}H${Math.max(...xs)}`);
      for (const sd of ["l", "r"]) { const o = ob.filter((q) => q.side === sd); if (o.length) bus.push(`M${o[0].vx},${Math.min(hy, ...o.map((q) => q.ty))}V${Math.max(hy, ...o.map((q) => q.ty))}`); }
      if (!two) yo1 = [1];
    }
    // Victron: ports as small pills on the inverter edges (clearer than loose text)
    this._el.ov.querySelectorAll(".port").forEach((e) => (e._seen = false));
    const port = (key, txt, x, y) => { let e = this._el.ov.querySelector(`.port[data-k="${key}"]`);
      if (!e) { e = document.createElement("div"); e.className = "port"; e.dataset.k = key; this._el.ov.appendChild(e); }
      e.textContent = txt; e._seen = true; const HH = this._ovH || 250; Object.assign(e.style, { left: x / 4 + "%", top: y / HH * 100 + "%" }); };
    if (vic) { const L = c.labels || {};
      port("in", L.ac_in || "AC-in", inT.x, inT.y + pY);
      if (yo1.length) port("o1", L.ac_out1 || "AC-out 1", W / 2, inT.y + inT.h);
      if (yo2.length) port("o2", L.ac_out2 || "AC-out 2", inT.x + MW, inT.y + pY); }
    this._el.ov.querySelectorAll(".port").forEach((e) => { if (!e._seen) e.remove(); });
    let lbl = "";
    if (false) { const t = (x, y, txt, anc) => `<text x="${x}" y="${y}" font-size="7.5" fill="currentColor" opacity=".55" text-anchor="${anc}" font-weight="600">${txt}</text>`;
      const L = c.labels || {};   // small labels on the stubs next to the inverter
      lbl += t(inT.x - 3, inT.y + inT.h / 2 - 5, L.ac_in || "AC-in", "end");
      if (yo1.length) lbl += t(W / 2 + 4, inT.y + inT.h + 10, L.ac_out1 || "AC-out 1", "start");
      if (yo2.length) lbl += t(W / 2 + 14, inT.y + inT.h + 34, L.ac_out2 || "AC-out 2", "start"); }
    this._el.ovsvg.innerHTML = lbl + bus.map((d) => `<path d="${d}" stroke="rgba(127,127,127,.45)"/>`).join("") + paths.slice().sort((a, b) => (a.pw || 1e9) - (b.pw || 1e9)).map((p) => `<path d="${p.d}" stroke="rgba(127,127,127,.35)"/>` + (p.on && !this._eMode ? `<path class="flow${p.rev ? " rev" : ""}" d="${p.d}" style="stroke:${p.color}"/>` : "")).join("");
  }
}
for (const m of ["_t", "_history", "_renderChart", "_stat"]) TotalHomeEnergyRingCard.prototype[m] = TotalHomeEnergyFlowCard.prototype[m];
TotalHomeEnergyRingCard.prototype._num = TotalHomeEnergyFlowCard.prototype._num;
if (!customElements.get("total-home-energy-ring-card")) {
  customElements.define("total-home-energy-ring-card", TotalHomeEnergyRingCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "total-home-energy-ring-card", name: "Total Home Energy Card", description: "Whole-home energy with every device you measure: battery ring, per-phase grid, solar, devices, live price and charts in ring, list and schematic views.", preview: false, documentationURL: "https://github.com/gjvdveen/total-home-energy-flow-card" });
}
