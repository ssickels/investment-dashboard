"use strict";

// ==================== HELPERS ====================

const fmt$ = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtPct = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Snap a target date string (YYYY-MM-DD) to the nearest date in the dates array. */
function snapDate(target, dates) {
  const t = new Date(target).getTime();
  let best = null;
  let bestDiff = Infinity;
  for (const d of dates) {
    const diff = Math.abs(new Date(d).getTime() - t);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best;
}

// ==================== FUND INFO ====================

const FUND_INFO = {
  // Modern DIY index
  VTI:   { name: "Vanguard Total Stock Market ETF",               cat: "US Large Blend" },
  VXUS:  { name: "Vanguard Total International Stock ETF",        cat: "Foreign Large Blend" },
  BND:   { name: "Vanguard Total Bond Market ETF",                cat: "Intermediate Core Bond" },
  // Pre-ETF DIY index
  VFINX: { name: "Vanguard 500 Index Fund",                       cat: "US Large Blend" },
  VWIGX: { name: "Vanguard International Growth Fund",            cat: "Foreign Large Growth" },
  VBMFX: { name: "Vanguard Total Bond Market Index",              cat: "Intermediate Core Bond" },
  // Active — American / Dodge
  AGTHX: { name: "American Funds Growth Fund of America A",       cat: "US Large Growth" },
  DODFX: { name: "Dodge & Cox International Stock",               cat: "Foreign Large Value" },
  PTTAX: { name: "PIMCO Total Return A",                          cat: "Intermediate Core-Plus Bond" },
  // Active — Fidelity (modern)
  FCNTX: { name: "Fidelity Contrafund",                           cat: "US Large Growth" },
  FIEUX: { name: "Fidelity Europe Fund",                          cat: "Europe Stock" },
  FTBFX: { name: "Fidelity Total Bond Fund",                      cat: "Intermediate Core Bond" },
  // Active — T. Rowe Price
  PRGFX: { name: "T. Rowe Price Growth Stock Fund",               cat: "US Large Growth" },
  PRITX: { name: "T. Rowe Price International Stock Fund",        cat: "Foreign Large Blend" },
  PRTIX: { name: "T. Rowe Price U.S. Bond Enhanced Index",        cat: "Intermediate Core Bond" },
  // Active — Vanguard active
  VWUSX: { name: "Vanguard U.S. Growth Fund",                     cat: "US Large Growth" },
  VWILX: { name: "Vanguard International Growth Fund (Admiral)",  cat: "Foreign Large Growth" },
  VBTLX: { name: "Vanguard Total Bond Market Index (Admiral)",    cat: "Intermediate Core Bond" },
  // Pre-ETF classic — Fidelity
  FMAGX: { name: "Fidelity Magellan Fund",                        cat: "US Large Growth" },
  FOSFX: { name: "Fidelity Overseas Fund",                        cat: "Foreign Large Growth" },
  FBNDX: { name: "Fidelity Investment Grade Bond",                cat: "Intermediate Core Bond" },
  // Pre-ETF classic — American Funds
  ANWPX: { name: "American Funds New Perspective Fund A",         cat: "World Large-Stock Growth" },
  ABNDX: { name: "American Funds Bond Fund of America A",         cat: "Intermediate Core Bond" },
  // Sector — pre-ETF mutual funds
  FRESX: { name: "Fidelity Real Estate Investment Portfolio",     cat: "Real Estate" },
  FSENX: { name: "Fidelity Select Energy Portfolio",              cat: "Equity Energy" },
  FSPHX: { name: "Fidelity Select Health Care Portfolio",         cat: "Health" },
  VGSIX: { name: "Vanguard REIT Index Fund",                      cat: "Real Estate" },
  // Sector ETFs — modern
  VNQ:   { name: "Vanguard Real Estate ETF",                      cat: "Real Estate" },
  XLE:   { name: "Energy Select Sector SPDR Fund",                cat: "Equity Energy" },
  XLV:   { name: "Health Care Select Sector SPDR Fund",           cat: "Health" },
  XLK:   { name: "Technology Select Sector SPDR Fund",            cat: "Technology" },
};

/**
 * Build a 3-column HTML table (Ticker / Name / Class) for one or more fund groups.
 * sections: [{heading, tickers}]  — heading may be null/falsy to omit the group header row.
 */
function fundTable(sections) {
  let html = '<table class="fund-tbl"><tr><th>Ticker</th><th>Name</th><th>Class</th></tr>';
  for (const { heading, tickers } of sections) {
    if (heading) {
      html += `<tr><td colspan="3" class="fund-tbl-head">${heading}</td></tr>`;
    }
    for (const t of tickers) {
      const info = FUND_INFO[t] || { name: t, cat: "—" };
      html += `<tr><td><strong>${t}</strong></td><td>${info.name}</td><td class="fund-tbl-cat">${info.cat}</td></tr>`;
    }
  }
  return html + '</table>';
}

/**
 * Position the floating tooltip near the cursor, clamping so it never
 * overflows the right or bottom edge of the viewport.
 * Must be called after tip.style.display = "block" so offsetWidth is non-zero.
 */
function positionTip(tip, clientX, clientY) {
  const x = Math.min(clientX + 14, window.innerWidth  - tip.offsetWidth  - 8);
  const y = Math.min(clientY + 14, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = x + "px";
  tip.style.top  = y + "px";
}

/**
 * Wire a floating fund-table tooltip to an element.
 * Assigns onmouse* properties so repeated calls on the same element overwrite cleanly.
 */
function wireFundHover(el, html) {
  if (!el) return;
  el.style.cursor = "help";
  el.style.textDecorationLine  = "underline";
  el.style.textDecorationStyle = "dotted";
  el.style.textDecorationColor = "#9ca3af";
  const tip = document.getElementById("legendTooltip");
  el.onmouseenter = (e) => { tip.innerHTML = html; tip.style.display = "block"; positionTip(tip, e.clientX, e.clientY); };
  el.onmousemove  = (e) => { positionTip(tip, e.clientX, e.clientY); };
  el.onmouseleave = ()  => { tip.style.display = "none"; };
}

// ==================== CHART SETUP ====================

let chart = null;
let scaleLocked = false;
let lockedYMin  = null;
let lockedYMax  = null;
let lastData    = null;
let legendTooltips = [];

function getDataExtremes(data) {
  const allVals = [
    ...data.scenarios.diy.values,
    ...data.scenarios.managed.values,
    ...data.scenarios.active.values,
    ...data.scenarios.active_managed.values,
  ];
  if (document.getElementById("showMomentum").checked && data.scenarios.diy_momentum && data.scenarios.active_momentum) {
    allVals.push(...data.scenarios.diy_momentum.values);
    allVals.push(...data.scenarios.active_momentum.values);
  }
  return { min: Math.min(...allVals), max: Math.max(...allVals) };
}

function handleScaleAfterRender(data) {
  if (!chart) return;
  const rescaleBtn = document.getElementById("rescaleBtn");
  if (!scaleLocked) {
    lockedYMin = chart.scales.y.min;
    lockedYMax = chart.scales.y.max;
    rescaleBtn.style.display = "none";
    return;
  }
  const { min, max } = getDataExtremes(data);
  rescaleBtn.style.display = (max > lockedYMax || min < lockedYMin) ? "inline-block" : "none";
}

function buildLegendTooltips(data) {
  const mu  = data.momentum_universe || {};
  const diy = data.diy_portfolio.tickers   || [];
  const act = data.active_fund_set.tickers || [];

  return [
    fundTable([{ heading: "No Advisor · Index funds · No fees", tickers: diy }]),
    fundTable([{ heading: "Index funds + AUM fee + fund expense ratio", tickers: diy }]),
    fundTable([{ heading: "No Advisor · Actively Managed", tickers: act }]),
    fundTable([{ heading: "Active funds + AUM fee", tickers: act }]),
    `<em>Total Invested</em><br><span style="color:#9ca3af;font-size:10px">Initial investment + monthly contributions</span>`,
    null,  // _fill dataset (hidden)
    (mu.diy_equity && mu.diy_equity.length)
      ? fundTable([{ heading: "Equity universe", tickers: mu.diy_equity }, { heading: "Bond universe", tickers: mu.diy_bond }])
      : null,
    (mu.active_equity && mu.active_equity.length)
      ? fundTable([{ heading: "Equity universe", tickers: mu.active_equity }, { heading: "Bond universe", tickers: mu.active_bond }])
      : null,
    // Yield curve inversion shading entry (index 8)
    `<strong>Yield Curve Inversion</strong><br>` +
    `<span style="color:#9ca3af;font-size:10px;line-height:1.6">` +
    `Periods when the 10-year Treasury yield fell below the 2-year yield.<br>` +
    `An inverted yield curve has historically preceded recessions by 6–24 months.<br>` +
    `Shading is approximate; not all inversions lead to recessions.<br>` +
    `Source: FRED T10Y2Y series.</span>`,
  ];
}

function buildChart(data) {
  const ctx = document.getElementById("mainChart").getContext("2d");

  // Rebuild legend tooltip content for this render
  legendTooltips = buildLegendTooltips(data);

  const labels = data.dates;

  const showAfterTax = data.taxable && document.getElementById("showAfterTax").checked;
  const pick = (sc) => showAfterTax ? sc.after_tax_values : sc.values;

  const diyVals            = pick(data.scenarios.diy);
  const managedVals        = pick(data.scenarios.managed);
  const activeVals         = pick(data.scenarios.active);
  const activeManagedVals  = pick(data.scenarios.active_managed);
  const momentumAvailable  = !!(data.scenarios.diy_momentum && data.scenarios.active_momentum);
  const diyMomentumVals    = momentumAvailable ? pick(data.scenarios.diy_momentum) : [];
  const activeMomentumVals = momentumAvailable ? pick(data.scenarios.active_momentum) : [];
  const momentumVisible    = momentumAvailable && document.getElementById("showMomentum").checked;

  const initialAmount  = parseFloat(document.getElementById("initialAmount").value) || 0;
  const monthlyContrib = parseFloat(document.getElementById("monthlyContrib").value) || 0;
  const contribVals    = data.dates.map((_, i) => initialAmount + i * monthlyContrib);

  // Crash annotation dates — snapped to available labels
  const CRASHES = [
    { label: "Dot-com\nPeak",         target: "2001-03-31" },
    { label: "Financial\nCrisis",     target: "2008-09-30" },
    { label: "COVID-19\nCrash",       target: "2020-02-29" },
  ];

  const annotations = {};

  // Yield curve inversion shading (drawn behind chart lines)
  const chartStartTime = labels.length ? new Date(labels[0]).getTime() : 0;
  const chartEndTime   = labels.length ? new Date(labels[labels.length - 1]).getTime() : 0;
  for (const period of (data.yield_curve_inversions || [])) {
    const pStart = new Date(period.start).getTime();
    const pEnd   = new Date(period.end).getTime();
    if (pEnd < chartStartTime || pStart > chartEndTime) continue;
    const snappedStart = snapDate(period.start, labels) || labels[0];
    const snappedEnd   = snapDate(period.end,   labels) || labels[labels.length - 1];
    annotations[`inv_${period.start}`] = {
      type: "box",
      xMin: snappedStart,
      xMax: snappedEnd,
      backgroundColor: "rgba(220,38,38,0.07)",
      borderWidth: 0,
      drawTime: "beforeDatasetsDraw",
    };
  }

  for (const crash of CRASHES) {
    const snapped = snapDate(crash.target, labels);
    if (!snapped) continue;
    const id = crash.label.replace(/\W+/g, "_");
    annotations[id] = {
      type: "line",
      xMin: snapped,
      xMax: snapped,
      borderColor: "rgba(156,163,175,0.7)",
      borderWidth: 1,
      borderDash: [4, 4],
      label: {
        content: crash.label.split("\n"),
        display: true,
        position: "start",
        backgroundColor: "rgba(100, 210, 230, 0.12)",
        color: "#5a9aaa",
        font: { size: 10 },
        padding: 4,
        borderRadius: 3,
      },
    };
  }

  const datasets = [
    {
      label: data.scenarios.diy.label,
      data: diyVals,
      borderColor: "#2563eb",
      backgroundColor: "rgba(37,99,235,0.06)",
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
    },
    {
      label: data.scenarios.managed.label,
      data: managedVals,
      borderColor: "#dc2626",
      backgroundColor: "rgba(220,38,38,0.06)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      borderDash: [5, 3],
      fill: false,
    },
    {
      label: data.scenarios.active.label,
      data: activeVals,
      borderColor: "#16a34a",
      backgroundColor: "rgba(22,163,74,0.06)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      borderDash: [2, 2],
      fill: false,
    },
    {
      label: data.scenarios.active_managed.label,
      data: activeManagedVals,
      borderColor: "#d97706",
      backgroundColor: "rgba(217,119,6,0.06)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      borderDash: [2, 2],
      fill: false,
    },
    {
      label: "Total Invested",
      data: contribVals,
      borderColor: "#6b7280",
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0,
      borderDash: [6, 3],
      fill: false,
    },
    // Invisible fill dataset between DIY (idx 0) and Active (idx 2)
    {
      label: "_fill",
      data: diyVals,
      borderColor: "transparent",
      backgroundColor: "rgba(37,99,235,0.06)",
      borderWidth: 0,
      pointRadius: 0,
      tension: 0.3,
      fill: { target: 2, above: "rgba(37,99,235,0.07)", below: "rgba(22,163,74,0.07)" },
    },
    {
      label: momentumAvailable ? data.scenarios.diy_momentum.label : "Index Momentum",
      data: diyMomentumVals,
      borderColor: "#7c3aed",
      backgroundColor: "rgba(124,58,237,0.06)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      borderDash: [5, 3],
      fill: false,
      hidden: !momentumVisible,
    },
    {
      label: momentumAvailable ? data.scenarios.active_momentum.label : "Active Momentum",
      data: activeMomentumVals,
      borderColor: "#0891b2",
      backgroundColor: "rgba(8,145,178,0.06)",
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.3,
      borderDash: [5, 3],
      fill: false,
      hidden: !momentumVisible,
    },
    // Index 8 — legend-only entry for yield curve inversion shading (no data points)
    {
      label: "Yield Curve Inversion",
      data: [],
      backgroundColor: "rgba(220,38,38,0.18)",
      borderColor: "rgba(220,38,38,0.45)",
      borderWidth: 1,
      pointRadius: 0,
      pointStyle: "rect",
      fill: false,
      hidden: !(data.yield_curve_inversions && data.yield_curve_inversions.length > 0),
    },
  ];

  const config = {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          onHover: (e, legendItem) => {
            const content = legendTooltips[legendItem.datasetIndex];
            if (!content || !e.native) return;
            const el = document.getElementById("legendTooltip");
            el.innerHTML = content;
            el.style.display = "block";
            positionTip(el, e.native.clientX, e.native.clientY);
          },
          onLeave: () => {
            document.getElementById("legendTooltip").style.display = "none";
          },
          onClick: (e, legendItem, legend) => {
            // Yield curve entry is informational only — clicking does nothing
            if (legendItem.text === "Yield Curve Inversion") return;
            // Default Chart.js toggle
            const idx = legendItem.datasetIndex;
            const ci = legend.chart;
            if (ci.isDatasetVisible(idx)) { ci.hide(idx); } else { ci.show(idx); }
            const nowVisible = ci.isDatasetVisible(idx);

            // Sync stat card checkbox (datasets 0–3)
            const cb = document.querySelector(`.stat-card-toggle[data-dataset-idx="${idx}"]`);
            if (cb) {
              cb.checked = nowVisible;
              cb.title = nowVisible
                ? "Uncheck to hide this line on the chart"
                : "Check to show this line on the chart";
            }

            // Sync "Show total invested" checkbox
            if (legendItem.text === "Total Invested") {
              document.getElementById("showContrib").checked = nowVisible;
            }

            // Sync "Show momentum" checkbox — uncheck only when both momentum lines are hidden
            if (legendItem.text.includes("Momentum")) {
              const anyMom = ci.data.datasets.some((ds, i) =>
                ds.label && ds.label.includes("Momentum") && ci.isDatasetVisible(i)
              );
              document.getElementById("showMomentum").checked = anyMom;
              document.getElementById("momentumStats").style.display = anyMom ? "block" : "none";
            }
          },
          labels: {
            filter: (item) => {
              if (item.text === "_fill") return false;
              if (item.text === "Total Invested") return document.getElementById("showContrib").checked;
              if (item.text.includes("Momentum")) return document.getElementById("showMomentum").checked;
              return true;
            },
            color: "#e4f6fb",
            font: { size: 12 },
            boxWidth: 20,
            usePointStyle: true,
          },
        },
        tooltip: {
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.label === "_fill") return null;
              return ` ${ctx.dataset.label}: ${fmt$.format(ctx.parsed.y)}`;
            },
          },
        },
        annotation: { annotations },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 10,
            font: { size: 11 },
            color: "#5a9aaa",
            maxRotation: 0,
            callback: function(value, index, ticks) {
              const label = this.getLabelForValue(value);
              const date = new Date(label + "T00:00:00");
              const totalMonths = this.chart.data.labels.length;
              if (totalMonths > 48) {
                return String(date.getFullYear());
              }
              return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
            },
          },
          grid: { color: "rgba(100,210,230,0.07)" },
        },
        y: {
          ticks: {
            callback: (v) => fmt$.format(v),
            font: { size: 11 },
            color: "#5a9aaa",
          },
          grid: { color: "rgba(100,210,230,0.07)" },
        },
      },
    },
  };

  const contribVisible = document.getElementById("showContrib").checked;

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets.forEach((ds, i) => {
      if (datasets[i]) {
        ds.data  = datasets[i].data;
        ds.label = datasets[i].label;
      }
    });
    chart.options.plugins.annotation.annotations = annotations;
    if (scaleLocked && lockedYMin !== null) {
      chart.options.scales.y.min = lockedYMin;
      chart.options.scales.y.max = lockedYMax;
    } else {
      chart.options.scales.y.min = undefined;
      chart.options.scales.y.max = undefined;
    }
    // Sync visibility toggles
    const contribIdx = chart.data.datasets.findIndex(ds => ds.label === "Total Invested");
    if (contribIdx !== -1) chart.getDatasetMeta(contribIdx).hidden = !contribVisible;
    // Respect stat card toggle states
    document.querySelectorAll(".stat-card-toggle").forEach(cb => {
      chart.getDatasetMeta(parseInt(cb.dataset.datasetIdx)).hidden = !cb.checked;
    });
    const diyMomIdx = chart.data.datasets.findIndex(ds => ds.label === datasets[6].label);
    if (diyMomIdx !== -1) chart.getDatasetMeta(diyMomIdx).hidden = !momentumVisible;
    const actMomIdx = chart.data.datasets.findIndex(ds => ds.label === datasets[7].label);
    if (actMomIdx !== -1) chart.getDatasetMeta(actMomIdx).hidden = !momentumVisible;
    const ycInvIdx = chart.data.datasets.findIndex(ds => ds.label === "Yield Curve Inversion");
    if (ycInvIdx !== -1) chart.getDatasetMeta(ycInvIdx).hidden = !(data.yield_curve_inversions && data.yield_curve_inversions.length > 0);
    chart.update();
  } else {
    chart = new Chart(ctx, config);
    // Apply initial visibility for all toggleable lines
    document.querySelectorAll(".stat-card-toggle").forEach(cb => {
      chart.getDatasetMeta(parseInt(cb.dataset.datasetIdx)).hidden = !cb.checked;
    });
    const contribIdx = chart.data.datasets.findIndex(ds => ds.label === "Total Invested");
    if (contribIdx !== -1) chart.getDatasetMeta(contribIdx).hidden = !contribVisible;
    chart.update("none");
  }
}

// ==================== STATS ====================

function updateStats(data) {
  const s = data.scenarios;
  const taxable = data.taxable;

  function fill(prefix, stats) {
    document.getElementById(`${prefix}Final`).textContent   = fmt$.format(stats.final_value);
    document.getElementById(`${prefix}Contrib`).textContent = fmt$.format(stats.total_contributions);
    document.getElementById(`${prefix}Gain`).textContent    = fmt$.format(stats.total_gain);
    document.getElementById(`${prefix}Cagr`).textContent    = fmtPct(stats.cagr);
    document.getElementById(`${prefix}Fees`).textContent    = fmt$.format(stats.total_fees_paid);
    // Tax rows (optional elements)
    const setPair = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt$.format(val); };
    setPair(`${prefix}TaxesPaid`, stats.total_taxes_paid || 0);
    setPair(`${prefix}TaxDue`,    stats.taxes_due_at_liquidation || 0);
    setPair(`${prefix}AfterTax`,  stats.after_tax_final != null ? stats.after_tax_final : stats.final_value);
  }

  fill("diy",            s.diy.stats);
  fill("managed",        s.managed.stats);
  fill("active",         s.active.stats);
  fill("activeManaged",  s.active_managed.stats);
  if (s.diy_momentum)    fill("diyMomentum",    s.diy_momentum.stats);
  if (s.active_momentum) fill("activeMomentum", s.active_momentum.stats);

  // Show/hide tax rows based on account type
  document.querySelectorAll(".tax-row").forEach(el => {
    el.style.display = taxable ? "" : "none";
  });

  // Manage "Show After-Tax Wealth" checkbox state
  const atCb = document.getElementById("showAfterTax");
  if (!taxable) {
    atCb.checked  = false;
    atCb.disabled = true;
  } else {
    atCb.disabled = false;
  }

  // Build fund tables for hover tooltips
  const diyTickers = data.diy_portfolio.tickers;
  const actTickers = data.active_fund_set.tickers;
  const mu = data.momentum_universe;

  const diyTbl = fundTable([{ heading: null, tickers: diyTickers }]);
  const actTbl = fundTable([{ heading: null, tickers: actTickers }]);

  // Stat card subtitles — plain text + hover table
  const diySubEl = document.getElementById("diyCardSub");
  diySubEl.textContent = diyTickers.join(" / ");
  wireFundHover(diySubEl, diyTbl);

  const mgdSubEl = document.getElementById("managedCardSub");
  mgdSubEl.textContent = diyTickers.join(" / ") + " + advisor fees";
  wireFundHover(mgdSubEl, diyTbl);

  const actSubEl = document.getElementById("activeCardSub");
  actSubEl.textContent = actTickers.join(" / ");
  wireFundHover(actSubEl, actTbl);

  const actMgdSubEl = document.getElementById("activeManagedCardSub");
  actMgdSubEl.textContent = actTickers.join(" / ") + " + advisor fees";
  wireFundHover(actMgdSubEl, actTbl);

  // Momentum card subtitles + group labels
  if (s.diy_momentum && mu) {
    const diyMomTbl = fundTable([{ heading: "Equity", tickers: mu.diy_equity }, { heading: "Bond", tickers: mu.diy_bond }]);
    const diyMomSubEl = document.getElementById("diyMomentumCardSub");
    diyMomSubEl.textContent = `${mu.diy_equity.length} equity · ${mu.diy_bond.length} bond · annual rotation`;
    wireFundHover(diyMomSubEl, diyMomTbl);
    const diyMomLabel = document.getElementById("diyMomentumGroupLabel");
    if (diyMomLabel) { diyMomLabel.textContent = "Index Momentum (With Advisor)"; wireFundHover(diyMomLabel, diyMomTbl); }
  }
  if (s.active_momentum && mu) {
    const actMomTbl = fundTable([{ heading: "Equity", tickers: mu.active_equity }, { heading: "Bond", tickers: mu.active_bond }]);
    const actMomSubEl = document.getElementById("activeMomentumCardSub");
    actMomSubEl.textContent = `${mu.active_equity.length} equity · ${mu.active_bond.length} bond · annual rotation`;
    wireFundHover(actMomSubEl, actMomTbl);
    const actMomLabel = document.getElementById("activeMomentumGroupLabel");
    if (actMomLabel) { actMomLabel.textContent = "Active Momentum (With Advisor)"; wireFundHover(actMomLabel, actMomTbl); }
  }

  // Sidebar: DIY fund display
  wireFundHover(document.getElementById("diyFundDisplay"), diyTbl);

  // Sidebar: "Actively Managed Funds" dropdown label → active momentum universe
  if (mu) {
    wireFundHover(
      document.getElementById("activeFundSetLabel"),
      fundTable([{ heading: "Momentum rotation universe — Equity", tickers: mu.active_equity }, { heading: "Bond", tickers: mu.active_bond }])
    );
  }

  // Sidebar: "Show momentum rotation" label → description tooltip
  const momentumTipEl = document.getElementById("showMomentumTip");
  if (momentumTipEl) {
    wireFundHover(
      momentumTipEl,
      `<strong>Momentum Rotation</strong><br><br>
Reveals two additional "With Advisor" scenarios that rebalance annually
using 12-month trailing momentum. Funds that performed best over the
prior year receive the largest allocation (≈50%); the worst performer
receives the smallest (≈17%).<br><br>
<em>No look-ahead:</em> weights at each rebalancing date use only returns
available up to the prior month. The first year uses equal weights while
momentum history accumulates.<br><br>
The <strong>Aggressiveness</strong> setting controls a yield-curve tactical
overlay: in Aggressive mode, equity is shifted toward bonds when the
10Y–2Y spread was negative in the prior year.`
    );
  }

  // Update weighted expense ratio display
  const wer = data.active_fund_set.weighted_expense_ratio;
  document.getElementById("erDisplay").textContent = `${wer.toFixed(2)}% / yr`;
}

function updateFeeDrag(data) {
  const fd = data.fee_drag;
  const s  = data.scenarios;
  const el = document.getElementById("feeDragText");

  const diyFinal    = s.diy.stats.final_value;
  const mgdFinal    = s.managed.stats.final_value;
  const actFinal    = s.active.stats.final_value;
  const actMgdFinal = s.active_managed.stats.final_value;

  // Scenario name with tooltip showing its final value and what costs are included
  function scen(label, finalVal, note) {
    const tt = `${label}  ·  Final value: ${fmt$.format(finalVal)}  ·  ${note}`;
    return `<span class="tooltip-term tooltip-term--wide" data-tooltip="${tt.replace(/"/g, "&quot;")}">${label}</span>`;
  }

  // Dollar difference with tooltip showing the explicit subtraction formula
  function diff(amount, a, b) {
    const tt = `How this is calculated: ${fmt$.format(a)} − ${fmt$.format(b)} = ${fmt$.format(Math.abs(amount))}`;
    return `<span class="tooltip-term tooltip-term--wide" data-tooltip="${tt}"><strong>${fmt$.format(Math.abs(amount))}</strong></span>`;
  }

  const lines = [];

  // 1. Advisor + fund expense drag on index funds
  const d1 = fd.diy_vs_managed;
  if (d1 >= 0) {
    lines.push(
      `${scen(s.diy.label, diyFinal, "No AUM fee; index fund returns at cost")} grew to <strong>${fmt$.format(diyFinal)}</strong>. ` +
      `${scen(s.managed.label, mgdFinal, "Same index funds — AUM fee + weighted active fund expense ratio deducted monthly")} would have ended at <strong>${fmt$.format(mgdFinal)}</strong>. ` +
      `Advisor and fund fees cost ${diff(d1, diyFinal, mgdFinal)} in final portfolio value.`
    );
  } else {
    lines.push(
      `In this period the fee-adjusted scenario edged out the no-fee index by ${diff(-d1, mgdFinal, diyFinal)} ` +
      `(${scen(s.managed.label, mgdFinal, "With AUM fee + fund expenses")} <strong>${fmt$.format(mgdFinal)}</strong> vs. ` +
      `${scen(s.diy.label, diyFinal, "No fees")} <strong>${fmt$.format(diyFinal)}</strong>).`
    );
  }

  // 2. Active management vs. passive index
  const d2 = fd.diy_vs_active;
  if (d2 >= 0) {
    lines.push(
      `Against ${scen(s.active.label, actFinal, "No advisor; fund expense ratios are already embedded in historical NAV prices")} ` +
      `(<strong>${fmt$.format(actFinal)}</strong>), the index portfolio finished ${diff(d2, diyFinal, actFinal)} ahead.`
    );
  } else {
    lines.push(
      `${scen(s.active.label, actFinal, "No advisor; expense ratios embedded in NAV")} ` +
      `(<strong>${fmt$.format(actFinal)}</strong>) beat the index by ${diff(-d2, actFinal, diyFinal)} ` +
      `— active management added value in this period.`
    );
  }

  // 3. Cost of adding an advisor to the active funds
  const d3 = fd.active_vs_active_managed;
  if (d3 >= 0) {
    lines.push(
      `Layering an advisor onto the active funds: ` +
      `${scen(s.active_managed.label, actMgdFinal, "Active funds + AUM fee deducted monthly")} ended at <strong>${fmt$.format(actMgdFinal)}</strong>, ` +
      `vs. <strong>${fmt$.format(actFinal)}</strong> without an advisor. ` +
      `The AUM fee cost ${diff(d3, actFinal, actMgdFinal)}.`
    );
  } else {
    lines.push(
      `The advisor-managed active portfolio ended ${diff(-d3, actMgdFinal, actFinal)} ahead of the no-advisor active baseline ` +
      `(<strong>${fmt$.format(actMgdFinal)}</strong> vs. <strong>${fmt$.format(actFinal)}</strong>).`
    );
  }

  el.innerHTML = lines.join("<br /><br />");
}

// ==================== FETCH & RENDER ====================

function getParams() {
  return {
    initial_amount:  document.getElementById("initialAmount").value,
    monthly_contrib: document.getElementById("monthlyContrib").value,
    start_date:      document.getElementById("startDate").value,
    end_date:        document.getElementById("endDate").value,
    stock_pct:       document.getElementById("stockPct").value,
    rebalance:       document.getElementById("rebalance").value,
    aum_fee:         document.getElementById("aumFee").value,
    inflation_adj:   document.getElementById("inflationAdj").checked ? "true" : "false",
    active_fund_set: document.getElementById("activeFundSet").value,
    diy_portfolio:   document.getElementById("diyPortfolio").value,
    aggressiveness:  document.querySelector("input[name='aggressiveness']:checked")?.value || "moderate",
    taxable:         document.querySelector("input[name='taxable']:checked")?.value ?? "true",
  };
}

async function fetchAndRender() {
  const overlay = document.getElementById("loadingOverlay");
  const errBanner = document.getElementById("errorBanner");
  overlay.style.display = "flex";
  errBanner.style.display = "none";

  const params = getParams();
  const qs = new URLSearchParams(params).toString();

  try {
    const resp = await fetch(`/api/portfolio?${qs}`);
    const data = await resp.json();

    if (!resp.ok || !data.scenarios) {
      throw new Error(data.error || `Server error ${resp.status}`);
    }

    // Initialize / update date picker bounds
    initDatePicker(data.meta.absolute_date_start, data.meta.absolute_date_end);

    // Date range note
    document.getElementById("dateRangeNote").textContent =
      `Common history: ${data.meta.date_range_start} → ${data.meta.date_range_end} (${data.meta.months_available} months)`;

    // Soft warning
    if (data.error) {
      errBanner.textContent = data.error;
      errBanner.style.display = "block";
    }

    lastData = data;
    buildChart(data);
    handleScaleAfterRender(data);
    updateStats(data);
    updateFeeDrag(data);

  } catch (err) {
    errBanner.textContent = `Error: ${err.message}`;
    errBanner.style.display = "block";
  } finally {
    overlay.style.display = "none";
  }
}

const debouncedFetch = debounce(fetchAndRender, 400);

// ==================== ACCOUNT TYPE SELECTION ====================

function setTaxable(value) {
  document.querySelectorAll(".agg-option", "#taxToggle").forEach(el => {
    const radio = el.querySelector("input[name='taxable']");
    if (!radio) return;
    radio.checked = radio.value === value;
    el.classList.toggle("agg-option--selected", radio.value === value);
  });
}

// ==================== AGGRESSIVENESS SELECTION ====================

function setAggressiveness(value) {
  document.querySelectorAll(".agg-option").forEach(el => {
    const radio = el.querySelector("input[name='aggressiveness']");
    if (radio) {
      radio.checked = radio.value === value;
      el.classList.toggle("agg-option--selected", radio.value === value);
    }
  });
}

function setAggEnabled(enabled) {
  const toggle = document.getElementById("aggToggle");
  if (!toggle) return;
  toggle.classList.toggle("agg-toggle--disabled", !enabled);
  document.querySelectorAll("input[name='aggressiveness']").forEach(r => {
    r.disabled = !enabled;
  });
}

// Tooltip on aggressiveness toggle when disabled
(function () {
  const toggle = document.getElementById("aggToggle");
  const tip    = document.getElementById("sidebarTooltip");
  if (!toggle || !tip) return;
  toggle.addEventListener("mouseenter", () => {
    if (!toggle.classList.contains("agg-toggle--disabled")) return;
    tip.textContent = "Available only when Show Momentum Rotation is checked.";
    tip.style.display = "block";
    const rect = toggle.getBoundingClientRect();
    const tipH = tip.getBoundingClientRect().height;
    let top  = rect.top - tipH - 8;
    if (top < 8) top = rect.bottom + 8;
    let left = rect.left;
    if (left + 448 > window.innerWidth) left = window.innerWidth - 456;
    tip.style.top  = top  + "px";
    tip.style.left = left + "px";
  });
  toggle.addEventListener("mouseleave", () => { tip.style.display = "none"; });
})();

// ==================== ERA SELECTION ====================

const ERA_CONFIG = {
  etf: {
    diyTickers: ["VTI", "VXUS", "BND"],
    diyDisplay: "VTI / VXUS / BND",
    activeFunds: [
      { value: "american_dodge",  label: "American/Dodge — AGTHX / DODFX / PTTAX" },
      { value: "fidelity",        label: "Fidelity — FCNTX / FIEUX / FTBFX" },
      { value: "vanguard_active", label: "Vanguard Active — VWUSX / VWILX / VBTLX" },
      { value: "t_rowe_price",    label: "T. Rowe Price — PRGFX / PRITX / PRTIX" },
    ],
  },
  pre_etf: {
    diyTickers: ["VFINX", "VWIGX", "VBMFX"],
    diyDisplay: "VFINX / VWIGX / VBMFX",
    activeFunds: [
      { value: "fidelity_classic", label: "Fidelity Classic — FMAGX / FOSFX / FBNDX" },
      { value: "american_funds",   label: "American Funds — AGTHX / ANWPX / ABNDX" },
      { value: "t_rowe_price",     label: "T. Rowe Price — PRGFX / PRITX / PRTIX (1989+)" },
    ],
  },
};

function setEra(era) {
  const config = ERA_CONFIG[era];

  // Update hidden input
  document.getElementById("diyPortfolio").value = era;

  // Update DIY fund display (hover wired after fetch in updateStats)
  document.getElementById("diyFundDisplay").textContent = config.diyTickers.join(" / ");

  // Check the matching radio button and style the labels
  document.querySelectorAll("input[name='era']").forEach(radio => {
    radio.checked = (radio.value === era);
  });
  document.querySelectorAll(".era-option").forEach(el => {
    el.classList.toggle("era-option--selected", el.querySelector("input[name='era']").value === era);
  });

  // Rebuild active fund dropdown, preserving selection if it exists in new era
  const sel = document.getElementById("activeFundSet");
  const prev = sel.value;
  sel.innerHTML = "";
  for (const { value, label } of config.activeFunds) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (config.activeFunds.some(f => f.value === prev)) {
    sel.value = prev;
  }
}

// ==================== DATE PICKER ====================

let pickerYear  = null;
let pickerMonth = null;  // 1-based
let endPickerYear  = null;
let endPickerMonth = null;
let pickerMinYear  = null;
let pickerMinMonth = null;
let pickerMaxYear  = null;
let pickerMaxMonth = null;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function pickerToYYYYMM(y, m) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Convert year/month to a comparable integer sequence
function toSeq(y, m) { return y * 12 + m; }

function updatePickerDisplay() {
  const startSeq = toSeq(pickerYear, pickerMonth);
  const minSeq   = toSeq(pickerMinYear, pickerMinMonth);
  // Start can advance up to one month before end
  const endSeq   = toSeq(endPickerYear ?? pickerMaxYear, endPickerMonth ?? pickerMaxMonth);
  const effMaxSeq = endSeq - 1;

  document.getElementById("pickerYear").textContent  = pickerYear  ?? "—";
  document.getElementById("pickerMonth").textContent = pickerMonth ? MONTH_NAMES[pickerMonth - 1] : "—";

  document.getElementById("pickerPrevYear").disabled  = pickerYear  <= pickerMinYear;
  document.getElementById("pickerNextYear").disabled  = pickerYear  >= Math.floor((effMaxSeq - 1) / 12);
  document.getElementById("pickerPrevMonth").disabled = startSeq   <= minSeq;
  document.getElementById("pickerNextMonth").disabled = startSeq   >= effMaxSeq;

  const val = pickerToYYYYMM(pickerYear, pickerMonth);
  const input = document.getElementById("startDate");
  if (input.value !== val) { input.value = val; debouncedFetch(); }
}

function updateEndPickerDisplay() {
  const endSeq   = toSeq(endPickerYear, endPickerMonth);
  const maxSeq   = toSeq(pickerMaxYear, pickerMaxMonth);
  // End can retreat down to one month after start
  const startSeq = toSeq(pickerYear ?? pickerMinYear, pickerMonth ?? pickerMinMonth);
  const effMinSeq = startSeq + 1;

  document.getElementById("endPickerYear").textContent  = endPickerYear  ?? "—";
  document.getElementById("endPickerMonth").textContent = endPickerMonth ? MONTH_NAMES[endPickerMonth - 1] : "—";

  document.getElementById("endPickerPrevYear").disabled  = endPickerYear  <= Math.ceil(effMinSeq / 12);
  document.getElementById("endPickerNextYear").disabled  = endPickerYear  >= pickerMaxYear;
  document.getElementById("endPickerPrevMonth").disabled = endSeq         <= effMinSeq;
  document.getElementById("endPickerNextMonth").disabled = endSeq         >= maxSeq;
  document.getElementById("endPickerReset").style.display = endSeq < maxSeq ? "inline-block" : "none";

  // Only send end_date to backend when it's before the absolute maximum
  const val = endSeq < maxSeq ? pickerToYYYYMM(endPickerYear, endPickerMonth) : "";
  const input = document.getElementById("endDate");
  if (input.value !== val) { input.value = val; debouncedFetch(); }
}

function clampPicker() {
  const minSeq = toSeq(pickerMinYear, pickerMinMonth);
  const endSeq = toSeq(endPickerYear ?? pickerMaxYear, endPickerMonth ?? pickerMaxMonth);
  let seq = toSeq(pickerYear, pickerMonth);
  seq = Math.max(minSeq, Math.min(endSeq - 1, seq));
  pickerYear  = Math.floor((seq - 1) / 12);
  pickerMonth = seq - pickerYear * 12;
}

function clampEndPicker() {
  const maxSeq   = toSeq(pickerMaxYear, pickerMaxMonth);
  const startSeq = toSeq(pickerYear ?? pickerMinYear, pickerMonth ?? pickerMinMonth);
  let seq = toSeq(endPickerYear, endPickerMonth);
  seq = Math.max(startSeq + 1, Math.min(maxSeq, seq));
  endPickerYear  = Math.floor((seq - 1) / 12);
  endPickerMonth = seq - endPickerYear * 12;
}

function initDatePicker(absStart, absEnd) {
  // absStart / absEnd are "YYYY-MM-DD" strings
  const [sy, sm] = absStart.split("-").map(Number);
  const [ey, em] = absEnd.split("-").map(Number);
  pickerMinYear  = sy;
  pickerMinMonth = sm;
  pickerMaxYear  = ey;
  pickerMaxMonth = em;

  if (pickerYear    === null) { pickerYear  = sy; pickerMonth  = sm; }  // first load: default to earliest
  if (endPickerYear === null) { endPickerYear = ey; endPickerMonth = em; }  // first load: default to latest

  clampPicker();
  clampEndPicker();
  updatePickerDisplay();
  updateEndPickerDisplay();
}

function movePickerYear(delta) {
  pickerYear += delta;
  clampPicker();
  updatePickerDisplay();
  updateEndPickerDisplay();  // refresh end picker disabled states
}

function movePickerMonth(delta) {
  pickerMonth += delta;
  if (pickerMonth < 1)  { pickerYear -= 1; pickerMonth = 12; }
  if (pickerMonth > 12) { pickerYear += 1; pickerMonth = 1;  }
  clampPicker();
  updatePickerDisplay();
  updateEndPickerDisplay();
}

function moveEndPickerYear(delta) {
  endPickerYear += delta;
  clampEndPicker();
  updateEndPickerDisplay();
  updatePickerDisplay();  // refresh start picker disabled states
}

function moveEndPickerMonth(delta) {
  endPickerMonth += delta;
  if (endPickerMonth < 1)  { endPickerYear -= 1; endPickerMonth = 12; }
  if (endPickerMonth > 12) { endPickerYear += 1; endPickerMonth = 1;  }
  clampEndPicker();
  updateEndPickerDisplay();
  updatePickerDisplay();
}

// ==================== WIRE UP INPUTS ====================

function wireInputs() {
  const ids = [
    "initialAmount", "monthlyContrib", "stockPct",
    "rebalance", "aumFee", "inflationAdj", "activeFundSet",
  ];

  for (const id of ids) {
    document.getElementById(id).addEventListener("input", debouncedFetch);
    document.getElementById(id).addEventListener("change", debouncedFetch);
  }

  // Era radio buttons
  document.querySelectorAll("input[name='era']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      setEra(e.target.value);
      debouncedFetch();
    });
  });

  // Account Type radio buttons (Taxable / Tax-Deferred)
  document.querySelectorAll("input[name='taxable']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      setTaxable(e.target.value);
      debouncedFetch();
    });
  });

  // Aggressiveness radio buttons
  document.querySelectorAll("input[name='aggressiveness']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      setAggressiveness(e.target.value);
      debouncedFetch();
    });
  });

  // Start date picker arrow buttons
  document.getElementById("pickerPrevYear").addEventListener("click",  () => movePickerYear(-1));
  document.getElementById("pickerNextYear").addEventListener("click",  () => movePickerYear(+1));
  document.getElementById("pickerPrevMonth").addEventListener("click", () => movePickerMonth(-1));
  document.getElementById("pickerNextMonth").addEventListener("click", () => movePickerMonth(+1));

  // End date picker arrow buttons
  document.getElementById("endPickerPrevYear").addEventListener("click",  () => moveEndPickerYear(-1));
  document.getElementById("endPickerNextYear").addEventListener("click",  () => moveEndPickerYear(+1));
  document.getElementById("endPickerPrevMonth").addEventListener("click", () => moveEndPickerMonth(-1));
  document.getElementById("endPickerNextMonth").addEventListener("click", () => moveEndPickerMonth(+1));
  document.getElementById("endPickerReset").addEventListener("click", () => {
    endPickerYear  = pickerMaxYear;
    endPickerMonth = pickerMaxMonth;
    clampEndPicker();
    updateEndPickerDisplay();
    updatePickerDisplay();
  });

  // Stat card visibility toggles
  document.querySelectorAll(".stat-card-toggle").forEach(cb => {
    cb.addEventListener("change", (e) => {
      if (!chart) return;
      const idx = parseInt(e.target.dataset.datasetIdx);
      chart.getDatasetMeta(idx).hidden = !e.target.checked;
      e.target.title = e.target.checked ? "Uncheck to hide this line on the chart" : "Check to show this line on the chart";
      chart.update();
    });
  });

  // Show total invested checkbox
  document.getElementById("showContrib").addEventListener("change", (e) => {
    if (!chart) return;
    const idx = chart.data.datasets.findIndex(ds => ds.label === "Total Invested");
    if (idx === -1) return;
    chart.getDatasetMeta(idx).hidden = !e.target.checked;
    chart.update();
  });

  // Show after-tax wealth checkbox
  document.getElementById("showAfterTax").addEventListener("change", () => {
    if (!lastData) return;
    buildChart(lastData);
  });

  // Show momentum rotation checkbox — also enables/disables aggressiveness
  document.getElementById("showMomentum").addEventListener("change", (e) => {
    setAggEnabled(e.target.checked);
    document.getElementById("momentumStats").style.display = e.target.checked ? "block" : "none";
    if (!chart || !lastData) return;
    buildChart(lastData);
  });

  // Scale lock checkbox
  document.getElementById("lockScale").addEventListener("change", (e) => {
    scaleLocked = e.target.checked;
    if (!chart) return;
    if (scaleLocked) {
      lockedYMin = chart.scales.y.min;
      lockedYMax = chart.scales.y.max;
      chart.options.scales.y.min = lockedYMin;
      chart.options.scales.y.max = lockedYMax;
    } else {
      chart.options.scales.y.min = undefined;
      chart.options.scales.y.max = undefined;
      document.getElementById("rescaleBtn").style.display = "none";
    }
    chart.update("none");
  });

  // Rescale button: auto-scale then re-lock at new bounds
  document.getElementById("rescaleBtn").addEventListener("click", () => {
    if (!chart) return;
    chart.options.scales.y.min = undefined;
    chart.options.scales.y.max = undefined;
    chart.update("none");
    lockedYMin = chart.scales.y.min;
    lockedYMax = chart.scales.y.max;
    chart.options.scales.y.min = lockedYMin;
    chart.options.scales.y.max = lockedYMax;
    chart.update("none");
    document.getElementById("rescaleBtn").style.display = "none";
  });

  // Slider display update (instant, no debounce)
  document.getElementById("stockPct").addEventListener("input", (e) => {
    document.getElementById("stockPctDisplay").textContent = e.target.value;
  });
}

// ==================== SIDEBAR TOGGLE ====================

document.getElementById("sidebarToggle").addEventListener("click", () => {
  const sidebar = document.getElementById("sidebar");
  const btn     = document.getElementById("sidebarToggle");
  const collapsed = sidebar.classList.toggle("sidebar--collapsed");
  btn.innerHTML  = collapsed ? "&#8250;" : "&#8249;";
  btn.title      = collapsed ? "Expand sidebar" : "Collapse sidebar";
  // Let the CSS transition finish before resizing the chart
  setTimeout(() => { if (chart) chart.resize(); }, 260);
});

// ==================== COLLAPSIBLE SIDEBAR GROUPS ====================
{
  const GROUP_TOOLTIPS = {
    'group-simulation': 'Set your starting balance, contributions, date range, and asset allocation.',
    'group-portfolio':  'Choose index vs. active funds, investment era, and advisor fee assumptions.',
    'group-display':    'Control tax treatment, inflation adjustment, and which chart lines are shown.',
  };

  document.querySelectorAll('.sidebar-group').forEach(group => {
    const btn     = group.querySelector('.sidebar-group-header');
    const content = group.querySelector('.sidebar-group-content');
    const tip     = group.id && GROUP_TOOLTIPS[group.id];

    // Restore saved state
    const saved = localStorage.getItem('sg-' + group.id);
    if (saved === 'collapsed') group.classList.add('is-collapsed');

    // Header tooltip
    if (tip) btn.title = tip;

    btn.addEventListener('click', () => {
      const collapsed = group.classList.toggle('is-collapsed');
      localStorage.setItem('sg-' + group.id, collapsed ? 'collapsed' : 'open');
    });
  });
}

// ==================== SIDEBAR TOOLTIPS ====================
// CSS ::after tooltips are clipped by overflow-y:auto — use JS fixed positioning instead.
{
  const tip = document.getElementById('sidebarTooltip');
  document.querySelectorAll('.sidebar .tooltip-term').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const text = el.getAttribute('data-tooltip');
      if (!text) return;
      tip.textContent = text;
      tip.style.display = 'block';
      const rect = el.getBoundingClientRect();
      const tipH = tip.getBoundingClientRect().height;
      let top  = rect.top - tipH - 8;
      if (top < 8) top = rect.bottom + 8;
      let left = rect.left;
      if (left + 448 > window.innerWidth) left = window.innerWidth - 456;
      tip.style.top  = top  + 'px';
      tip.style.left = left + 'px';
    });
    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}

// ==================== INIT ====================

setEra("etf");
wireInputs();
fetchAndRender();
