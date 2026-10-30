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

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ==================== FUND INFO ====================

const FUND_INFO = {
  VTI:   { name: "Vanguard Total Stock Market ETF",               cat: "US Large Blend" },
  VXUS:  { name: "Vanguard Total International Stock ETF",        cat: "Foreign Large Blend" },
  BND:   { name: "Vanguard Total Bond Market ETF",                cat: "Intermediate Core Bond" },
  VFINX: { name: "Vanguard 500 Index Fund",                       cat: "US Large Blend" },
  VWIGX: { name: "Vanguard International Growth Fund",            cat: "Foreign Large Growth" },
  VBMFX: { name: "Vanguard Total Bond Market Index",              cat: "Intermediate Core Bond" },
  AGTHX: { name: "American Funds Growth Fund of America A",       cat: "US Large Growth" },
  DODFX: { name: "Dodge & Cox International Stock",               cat: "Foreign Large Value" },
  PTTAX: { name: "PIMCO Total Return A",                          cat: "Intermediate Core-Plus Bond" },
  FCNTX: { name: "Fidelity Contrafund",                           cat: "US Large Growth" },
  FIEUX: { name: "Fidelity Europe Fund",                          cat: "Europe Stock" },
  FTBFX: { name: "Fidelity Total Bond Fund",                      cat: "Intermediate Core Bond" },
  PRGFX: { name: "T. Rowe Price Growth Stock Fund",               cat: "US Large Growth" },
  PRITX: { name: "T. Rowe Price International Stock Fund",        cat: "Foreign Large Blend" },
  PRTIX: { name: "T. Rowe Price U.S. Bond Enhanced Index",        cat: "Intermediate Core Bond" },
  VWUSX: { name: "Vanguard U.S. Growth Fund",                     cat: "US Large Growth" },
  VWILX: { name: "Vanguard International Growth Fund (Admiral)",  cat: "Foreign Large Growth" },
  VBTLX: { name: "Vanguard Total Bond Market Index (Admiral)",    cat: "Intermediate Core Bond" },
  FMAGX: { name: "Fidelity Magellan Fund",                        cat: "US Large Growth" },
  FOSFX: { name: "Fidelity Overseas Fund",                        cat: "Foreign Large Growth" },
  FBNDX: { name: "Fidelity Investment Grade Bond",                cat: "Intermediate Core Bond" },
  ANWPX: { name: "American Funds New Perspective Fund A",         cat: "World Large-Stock Growth" },
  ABNDX: { name: "American Funds Bond Fund of America A",         cat: "Intermediate Core Bond" },
  FRESX: { name: "Fidelity Real Estate Investment Portfolio",     cat: "Real Estate" },
  FSENX: { name: "Fidelity Select Energy Portfolio",              cat: "Equity Energy" },
  FSPHX: { name: "Fidelity Select Health Care Portfolio",         cat: "Health" },
  VGSIX: { name: "Vanguard REIT Index Fund",                      cat: "Real Estate" },
  VNQ:   { name: "Vanguard Real Estate ETF",                      cat: "Real Estate" },
  XLE:   { name: "Energy Select Sector SPDR Fund",                cat: "Equity Energy" },
  XLV:   { name: "Health Care Select Sector SPDR Fund",           cat: "Health" },
  XLK:   { name: "Technology Select Sector SPDR Fund",            cat: "Technology" },
};

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

function positionTip(tip, clientX, clientY) {
  const x = Math.min(clientX + 14, window.innerWidth  - tip.offsetWidth  - 8);
  const y = Math.min(clientY + 14, window.innerHeight - tip.offsetHeight - 8);
  tip.style.left = x + "px";
  tip.style.top  = y + "px";
}

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

// ==================== STRATEGY CONFIG ====================

const STRATEGIES = {
  diy: {
    label: "Low-Cost Index / No Advisor",
    scenarioKey: "diy",
    hasAdvisor: false,
    momentumKey: null,
    // [No Rebalancing, Quarterly, Annually]
    colors: ["#93c5fd", "#60a5fa", "#2563eb"],
  },
  managed: {
    label: "Low-Cost Index / With Advisor",
    scenarioKey: "managed",
    hasAdvisor: true,
    momentumKey: "diy_momentum",
    colors: ["#fca5a5", "#f87171", "#dc2626"],
  },
  active: {
    label: "Actively Managed / No Advisor",
    scenarioKey: "active",
    hasAdvisor: false,
    momentumKey: null,
    colors: ["#86efac", "#4ade80", "#16a34a"],
  },
  active_managed: {
    label: "Actively Managed / With Advisor",
    scenarioKey: "active_managed",
    hasAdvisor: true,
    momentumKey: "active_momentum",
    colors: ["#fdba74", "#fb923c", "#d97706"],
  },
};

const REBAL_MODES  = ["never", "quarterly", "annually"];
const REBAL_LABELS = ["No Rebalancing", "Quarterly Rebalancing", "Annual Rebalancing"];
const REBAL_DASHES = [[8, 4], [3, 3], []];
const REBAL_WIDTHS = [2.5, 2, 2.5];

// ==================== CHART SETUP ====================

let chart = null;
let scaleLocked = false;
let lightChart  = false;
let currentChartStrategy = null;

const CHART_DARK = {
  legendColor:   '#e4f6fb',
  tooltipBg:     '#002d3d',
  tooltipBorder: 'rgba(100,210,230,0.32)',
  tooltipTitle:  '#5a9aaa',
  tooltipBody:   '#e4f6fb',
  tickColor:     '#5a9aaa',
  gridColor:     'rgba(100,210,230,0.07)',
  containerBg:   '',
};
const CHART_LIGHT = {
  legendColor:   '#1f2937',
  tooltipBg:     '#ffffff',
  tooltipBorder: 'rgba(0,0,0,0.15)',
  tooltipTitle:  '#6b7280',
  tooltipBody:   '#1f2937',
  tickColor:     '#4b5563',
  gridColor:     'rgba(0,0,0,0.08)',
  containerBg:   '#f5f4f0',
};

function applyChartTheme(light) {
  const t = light ? CHART_LIGHT : CHART_DARK;
  document.querySelector('.chart-container').style.background = t.containerBg;
  const btn = document.getElementById('chartThemeBtn');
  if (btn) {
    btn.textContent = light ? '◑' : '☀';
    btn.title = light ? 'Switch to dark chart background' : 'Switch to light chart background';
  }
  applyDriftTheme();
  if (!chart) return;
  chart.options.plugins.legend.labels.color        = t.legendColor;
  chart.options.plugins.tooltip.backgroundColor    = t.tooltipBg;
  chart.options.plugins.tooltip.borderColor        = t.tooltipBorder;
  chart.options.plugins.tooltip.titleColor         = t.tooltipTitle;
  chart.options.plugins.tooltip.bodyColor          = t.tooltipBody;
  chart.options.scales.x.ticks.color              = t.tickColor;
  chart.options.scales.y.ticks.color              = t.tickColor;
  chart.options.scales.x.grid.color               = t.gridColor;
  chart.options.scales.y.grid.color               = t.gridColor;
  chart.update('none');
}

let lockedYMin  = null;
let lockedYMax  = null;
let lastResults = null;   // { never: data, quarterly: data, annually: data, ref: data }
let selectedStrategy = "diy";
let legendTooltips = [];

// ==================== STRATEGY SELECTION ====================

function setStrategy(value) {
  selectedStrategy = value;
  const strategy = STRATEGIES[value];

  // Update radio buttons
  document.querySelectorAll("input[name='strategy']").forEach(r => {
    r.checked = r.value === value;
  });
  document.querySelectorAll(".strategy-option").forEach(el => {
    el.classList.toggle("strategy-option--selected",
      el.querySelector("input[name='strategy']").value === value);
  });

  // Show/hide momentum checkbox (only for With Advisor strategies)
  const momGroup = document.getElementById("momentumGroup");
  if (momGroup) {
    momGroup.style.display = strategy.hasAdvisor ? "" : "none";
    if (!strategy.hasAdvisor) {
      document.getElementById("showMomentum").checked = false;
      document.getElementById("momentumStats").style.display = "none";
      setAggEnabled(false);
    }
  }

  // Dim advisor costs section for No Advisor strategies
  const aumGroup = document.getElementById("aumFeeGroup");
  const aumHeader = document.getElementById("advisorCostsHeader");
  if (aumGroup) aumGroup.style.opacity = strategy.hasAdvisor ? "1" : "0.4";
  if (aumHeader) aumHeader.style.opacity = strategy.hasAdvisor ? "1" : "0.4";

  // Re-render from cached data (no re-fetch needed)
  if (lastResults) {
    buildChart(lastResults);
    handleScaleAfterRender(lastResults);
    updateStats(lastResults);
    updateCallout(lastResults);
    invalidateDriftPanel();
  }
}

// ==================== CHART BUILDING ====================

function getDataExtremes(results) {
  const strategy = STRATEGIES[selectedStrategy];
  const key = strategy.scenarioKey;
  const allVals = [
    ...results.never.scenarios[key].values,
    ...results.quarterly.scenarios[key].values,
    ...results.annually.scenarios[key].values,
  ];
  const momKey = strategy.momentumKey;
  if (document.getElementById("showMomentum").checked && momKey && results.annually.scenarios[momKey]) {
    allVals.push(...results.annually.scenarios[momKey].values);
  }
  return { min: Math.min(...allVals), max: Math.max(...allVals) };
}

function handleScaleAfterRender(results) {
  if (!chart) return;
  const rescaleBtn = document.getElementById("rescaleBtn");
  if (!scaleLocked) {
    lockedYMin = chart.scales.y.min;
    lockedYMax = chart.scales.y.max;
    rescaleBtn.style.display = "none";
    return;
  }
  const { min, max } = getDataExtremes(results);
  rescaleBtn.style.display = (max > lockedYMax || min < lockedYMin) ? "inline-block" : "none";
}

function buildLegendTooltips(results) {
  const strategy = STRATEGIES[selectedStrategy];
  const ref = results.ref;
  const diy = ref.diy_portfolio.tickers || [];
  const act = ref.active_fund_set.tickers || [];
  const mu  = ref.momentum_universe || {};
  const isIndex = (strategy.scenarioKey === "diy" || strategy.scenarioKey === "managed");
  const tickers = isIndex ? diy : act;
  const advisorNote = strategy.hasAdvisor ? " + AUM fee" : "";
  const heading = isIndex ? "Index funds" : "Actively Managed funds";

  const baseTip = fundTable([{ heading: heading + advisorNote, tickers }]);

  // Build momentum tooltip
  let momTip = null;
  if (strategy.momentumKey === "diy_momentum" && mu.diy_equity) {
    momTip = fundTable([{ heading: "Equity universe", tickers: mu.diy_equity }, { heading: "Bond universe", tickers: mu.diy_bond }]);
  } else if (strategy.momentumKey === "active_momentum" && mu.active_equity) {
    momTip = fundTable([{ heading: "Equity universe", tickers: mu.active_equity }, { heading: "Bond universe", tickers: mu.active_bond }]);
  }

  return [
    baseTip,  // 0: No Rebalancing
    baseTip,  // 1: Quarterly
    baseTip,  // 2: Annually
    `<em>Total Invested</em><br><span style="color:#9ca3af;font-size:10px">Initial investment + monthly contributions</span>`,  // 3
    momTip,   // 4: Momentum
    // 5: Yield curve inversion
    `<strong>Yield Curve Inversion</strong><br>` +
    `<span style="color:#9ca3af;font-size:10px;line-height:1.6">` +
    `Periods when the 10-year Treasury yield fell below the 2-year yield.<br>` +
    `An inverted yield curve has historically preceded recessions by 6–24 months.<br>` +
    `Source: FRED T10Y2Y series.</span>`,
  ];
}

function buildChart(results) {
  const ctx = document.getElementById("mainChart").getContext("2d");
  const strategy = STRATEGIES[selectedStrategy];
  const colors = strategy.colors;
  const scenarioKey = strategy.scenarioKey;
  const needsRecreate = !chart || currentChartStrategy !== selectedStrategy;

  legendTooltips = buildLegendTooltips(results);

  const labels = results.ref.dates;
  const showAfterTax = results.ref.taxable && document.getElementById("showAfterTax").checked;
  const pick = (sc) => showAfterTax ? sc.after_tax_values : sc.values;

  const neverVals     = pick(results.never.scenarios[scenarioKey]);
  const quarterlyVals = pick(results.quarterly.scenarios[scenarioKey]);
  const annuallyVals  = pick(results.annually.scenarios[scenarioKey]);

  const momKey = strategy.momentumKey;
  const momentumAvailable = !!(momKey && results.annually.scenarios[momKey]);
  const momentumVisible   = momentumAvailable && document.getElementById("showMomentum").checked;
  const momentumVals      = momentumAvailable ? pick(results.annually.scenarios[momKey]) : [];

  const initialAmount  = parseFloat(document.getElementById("initialAmount").value) || 0;
  const monthlyContrib = parseFloat(document.getElementById("monthlyContrib").value) || 0;
  const contribVals    = labels.map((_, i) => initialAmount + i * monthlyContrib);

  // Annotations
  const annotations = {};
  const chartStartTime = labels.length ? new Date(labels[0]).getTime() : 0;
  const chartEndTime   = labels.length ? new Date(labels[labels.length - 1]).getTime() : 0;

  // Yield curve inversions
  for (const period of (results.ref.yield_curve_inversions || [])) {
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

  // Crash markers
  const CRASHES = [
    { label: "Dot-com Peak",       target: "2001-03-31" },
    { label: "Financial Crisis",   target: "2008-09-30" },
    { label: "COVID-19 Crash",     target: "2020-02-29" },
  ];
  for (const crash of CRASHES) {
    const crashTime = new Date(crash.target).getTime();
    if (crashTime < chartStartTime || crashTime > chartEndTime) continue;
    const snapped = snapDate(crash.target, labels);
    if (!snapped) continue;
    annotations[crash.label.replace(/\W+/g, "_")] = {
      type: "line",
      xMin: snapped,
      xMax: snapped,
      borderColor: "rgba(156,163,175,0.7)",
      borderWidth: 1,
      borderDash: [4, 4],
      label: {
        content: crash.label,
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
    // 0: No Rebalancing
    {
      label: REBAL_LABELS[0],
      data: neverVals,
      borderColor: colors[0],
      backgroundColor: "transparent",
      borderWidth: REBAL_WIDTHS[0],
      borderDash: REBAL_DASHES[0],
      pointRadius: 0,
      pointStyle: "line",
      tension: 0.3,
      fill: false,
    },
    // 1: Quarterly
    {
      label: REBAL_LABELS[1],
      data: quarterlyVals,
      borderColor: colors[1],
      backgroundColor: "transparent",
      borderWidth: REBAL_WIDTHS[1],
      borderDash: REBAL_DASHES[1],
      pointRadius: 0,
      pointStyle: "line",
      tension: 0.3,
      fill: false,
    },
    // 2: Annually
    {
      label: REBAL_LABELS[2],
      data: annuallyVals,
      borderColor: colors[2],
      backgroundColor: "transparent",
      borderWidth: REBAL_WIDTHS[2],
      borderDash: REBAL_DASHES[2],
      pointRadius: 0,
      pointStyle: "line",
      tension: 0.3,
      fill: false,
    },
    // 3: Total Invested
    {
      label: "Total Invested",
      data: contribVals,
      borderColor: "#6b7280",
      borderWidth: 1.5,
      pointRadius: 0,
      pointStyle: "line",
      tension: 0,
      borderDash: [6, 3],
      fill: false,
    },
    // 4: Momentum
    {
      label: momentumAvailable ? results.annually.scenarios[momKey].label : "Momentum Rotation",
      data: momentumVals,
      borderColor: "#7c3aed",
      backgroundColor: "transparent",
      borderWidth: 2,
      pointRadius: 0,
      pointStyle: "line",
      tension: 0.3,
      borderDash: [5, 3],
      fill: false,
      hidden: !momentumVisible,
    },
    // 5: Yield Curve Inversion (legend-only)
    {
      label: "Yield Curve Inversion",
      data: [],
      backgroundColor: "rgba(220,38,38,0.18)",
      borderColor: "rgba(220,38,38,0.45)",
      borderWidth: 1,
      pointRadius: 0,
      pointStyle: "rect",
      fill: false,
      hidden: !(results.ref.yield_curve_inversions && results.ref.yield_curve_inversions.length > 0),
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
            if (legendItem.text === "Yield Curve Inversion") return;
            const idx = legendItem.datasetIndex;
            const ci = legend.chart;
            if (ci.isDatasetVisible(idx)) { ci.hide(idx); } else { ci.show(idx); }
            const nowVisible = ci.isDatasetVisible(idx);

            // Sync stat card checkbox (datasets 0–2)
            const cb = document.querySelector(`.stat-card-toggle[data-dataset-idx="${idx}"]`);
            if (cb) {
              cb.checked = nowVisible;
              cb.title = nowVisible
                ? "Uncheck to hide this line on the chart"
                : "Check to show this line on the chart";
              cb.closest(".stat-card").classList.toggle("line-hidden", !nowVisible);
              syncDriftVisibility();
            }

            if (legendItem.text === "Total Invested") {
              document.getElementById("showContrib").checked = nowVisible;
            }

            if (legendItem.text.includes("Momentum")) {
              const anyMom = ci.data.datasets.some((ds, i) =>
                ds.label && ds.label.includes("Momentum") && ci.isDatasetVisible(i)
              );
              document.getElementById("showMomentum").checked = anyMom;
              document.getElementById("momentumStats").style.display = anyMom ? "block" : "none";
            }
          },
          labels: {
            generateLabels: (chart) => {
              const defaults = Chart.defaults.plugins.legend.labels.generateLabels(chart);
              defaults.forEach((item) => {
                const ds = chart.data.datasets[item.datasetIndex];
                if (ds && ds.borderDash) item.lineDash = ds.borderDash;
              });
              return defaults;
            },
            filter: (item) => {

              if (item.text === "Total Invested") return document.getElementById("showContrib").checked;
              if (item.text.includes("Momentum")) return document.getElementById("showMomentum").checked;
              if (item.hidden) return false;
              return true;
            },
            color: "#e4f6fb",
            font: { size: 12 },
            boxWidth: 30,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: '#002d3d',
          borderColor: 'rgba(100, 210, 230, 0.32)',
          borderWidth: 1,
          titleColor: '#5a9aaa',
          bodyColor: '#e4f6fb',
          padding: 10,
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: {
            label: (ctx) => {

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
            callback: function(value) {
              const label = this.getLabelForValue(value);
              const date = new Date(label + "T00:00:00");
              const totalMonths = this.chart.data.labels.length;
              if (totalMonths > 48) return String(date.getFullYear());
              return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
            },
          },
          grid: { color: "rgba(100,210,230,0.07)" },
        },
        y: {
          type: document.getElementById("logScale").checked ? "logarithmic" : "linear",
          min: (scaleLocked && lockedYMin !== null) ? lockedYMin : undefined,
          max: (scaleLocked && lockedYMax !== null) ? lockedYMax : undefined,
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

  const contribVisible  = document.getElementById("showContrib").checked;

  if (needsRecreate) {
    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart(ctx, config);
    // Initial visibility
    document.querySelectorAll(".stat-card-toggle").forEach(cb => {
      const idx = parseInt(cb.dataset.datasetIdx);
      if (idx < chart.data.datasets.length) {
        chart.getDatasetMeta(idx).hidden = !cb.checked;
      }
    });
    // Momentum datasets must respect the showMomentum checkbox, not just the stat-card toggle
    [6, 7].forEach(idx => {
      if (idx < chart.data.datasets.length) {
        chart.getDatasetMeta(idx).hidden = !momentumVisible || chart.getDatasetMeta(idx).hidden;
      }
    });
    const contribIdx = chart.data.datasets.findIndex(ds => ds.label === "Total Invested");
    if (contribIdx !== -1) chart.getDatasetMeta(contribIdx).hidden = !contribVisible;
    chart.update("none");
    applyChartTheme(lightChart);
    currentChartStrategy = selectedStrategy;
  } else {
    // Update in-place
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
    const contribIdx = chart.data.datasets.findIndex(ds => ds.label === "Total Invested");
    if (contribIdx !== -1) chart.getDatasetMeta(contribIdx).hidden = !contribVisible;
    document.querySelectorAll(".stat-card-toggle").forEach(cb => {
      const idx = parseInt(cb.dataset.datasetIdx);
      if (idx < chart.data.datasets.length) {
        chart.getDatasetMeta(idx).hidden = !cb.checked;
      }
    });
    const momIdx = chart.data.datasets.findIndex(ds => ds.label === datasets[4].label);
    if (momIdx !== -1) chart.getDatasetMeta(momIdx).hidden = !momentumVisible;
    const ycIdx = chart.data.datasets.findIndex(ds => ds.label === "Yield Curve Inversion");
    if (ycIdx !== -1) chart.getDatasetMeta(ycIdx).hidden = !(results.ref.yield_curve_inversions && results.ref.yield_curve_inversions.length > 0);
    chart.update();
  }
}

// ==================== STATS ====================

function updateStats(results) {
  const strategy = STRATEGIES[selectedStrategy];
  const scenarioKey = strategy.scenarioKey;
  const colors = strategy.colors;
  const taxable = results.ref.taxable;

  function fill(prefix, stats) {
    document.getElementById(`${prefix}Final`).textContent   = fmt$.format(stats.final_value);
    document.getElementById(`${prefix}Contrib`).textContent = fmt$.format(stats.total_contributions);
    document.getElementById(`${prefix}Gain`).textContent    = fmt$.format(stats.total_gain);
    document.getElementById(`${prefix}Cagr`).textContent    = fmtPct(stats.cagr);
    document.getElementById(`${prefix}Fees`).textContent    = fmt$.format(stats.total_fees_paid);
    const setPair = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt$.format(val); };
    setPair(`${prefix}TaxesPaid`, stats.total_taxes_paid || 0);
    setPair(`${prefix}TaxDue`,    stats.taxes_due_at_liquidation || 0);
    setPair(`${prefix}AfterTax`,  stats.after_tax_final != null ? stats.after_tax_final : stats.final_value);
  }

  fill("never",     results.never.scenarios[scenarioKey].stats);
  fill("quarterly", results.quarterly.scenarios[scenarioKey].stats);
  fill("annually",  results.annually.scenarios[scenarioKey].stats);

  // Momentum card
  const momKey = strategy.momentumKey;
  if (momKey && results.annually.scenarios[momKey]) {
    fill("momentum", results.annually.scenarios[momKey].stats);
  }

  // Update card colors dynamically
  const cards   = ["statsNever", "statsQuarterly", "statsAnnually"];
  const swatches = ["neverSwatch", "quarterlySwatch", "annuallySwatch"];
  const dashes  = ["8 4", "3 3", ""];

  for (let i = 0; i < 3; i++) {
    document.getElementById(cards[i]).style.borderTopColor = colors[i];
    const line = document.querySelector(`#${swatches[i]} line`);
    if (line) {
      line.setAttribute("stroke", colors[i]);
      line.setAttribute("stroke-dasharray", dashes[i]);
    }
  }

  // Update group label
  document.getElementById("rebalGroupLabel").textContent = strategy.label;

  // Show/hide tax rows
  document.querySelectorAll(".tax-row").forEach(el => {
    el.style.display = taxable ? "" : "none";
  });
  // "Taxes Paid" row only for With Advisor strategies
  document.querySelectorAll(".tax-paid-row").forEach(el => {
    el.style.display = (taxable && strategy.hasAdvisor) ? "" : "none";
  });

  // Show after-tax checkbox state
  const atCb = document.getElementById("showAfterTax");
  if (!taxable) {
    atCb.checked  = false;
    atCb.disabled = true;
  } else {
    atCb.disabled = false;
  }

  // Wire fund hover tooltips on card subtitles
  const ref = results.ref;
  const diyTickers = ref.diy_portfolio.tickers;
  const actTickers = ref.active_fund_set.tickers;
  const isIndex = (scenarioKey === "diy" || scenarioKey === "managed");
  const tickers = isIndex ? diyTickers : actTickers;
  const tbl = fundTable([{ heading: null, tickers }]);

  const cardSubs = ["neverCardSub", "quarterlyCardSub", "annuallyCardSub"];
  for (const id of cardSubs) {
    const el = document.getElementById(id);
    if (el) wireFundHover(el, tbl);
  }

  // Momentum card subtitle
  const mu = ref.momentum_universe;
  if (momKey && mu) {
    const momEq = momKey === "diy_momentum" ? mu.diy_equity : mu.active_equity;
    const momBd = momKey === "diy_momentum" ? mu.diy_bond : mu.active_bond;
    if (momEq) {
      const momTbl = fundTable([{ heading: "Equity", tickers: momEq }, { heading: "Bond", tickers: momBd }]);
      const momSubEl = document.getElementById("momentumCardSub");
      if (momSubEl) {
        momSubEl.textContent = `${momEq.length} equity · ${momBd.length} bond · annual rotation`;
        wireFundHover(momSubEl, momTbl);
      }
      const momLabel = document.getElementById("momentumGroupLabel");
      if (momLabel) {
        momLabel.textContent = isIndex ? "Index Momentum (With Advisor)" : "Active Momentum (With Advisor)";
        wireFundHover(momLabel, momTbl);
      }
    }
  }

  // Sidebar: DIY fund display
  wireFundHover(document.getElementById("diyFundDisplay"), fundTable([{ heading: null, tickers: diyTickers }]));

  // Sidebar: active fund set label → momentum universe
  if (mu) {
    wireFundHover(
      document.getElementById("activeFundSetLabel"),
      fundTable([{ heading: "Momentum rotation universe — Equity", tickers: mu.active_equity }, { heading: "Bond", tickers: mu.active_bond }])
    );
  }

  // Sidebar: momentum tooltip
  const momentumTipEl = document.getElementById("showMomentumTip");
  if (momentumTipEl) {
    wireFundHover(
      momentumTipEl,
      `<strong>Momentum Rotation</strong><br><br>
Reveals an additional "With Advisor" scenario that rebalances annually
using 12-month trailing momentum. Funds that performed best over the
prior year receive the largest allocation.<br><br>
<em>Note:</em> Momentum always uses annual rotation regardless of the
rebalancing comparison shown on the chart.`
    );
  }

  // Weighted expense ratio display
  const wer = ref.active_fund_set.weighted_expense_ratio;
  document.getElementById("erDisplay").textContent = `${wer.toFixed(2)}% / yr`;
}

function updateCallout(results) {
  const strategy = STRATEGIES[selectedStrategy];
  const key = strategy.scenarioKey;

  const neverFinal     = results.never.scenarios[key].stats.final_value;
  const quarterlyFinal = results.quarterly.scenarios[key].stats.final_value;
  const annuallyFinal  = results.annually.scenarios[key].stats.final_value;

  const neverCagr     = results.never.scenarios[key].stats.cagr;
  const quarterlyCagr = results.quarterly.scenarios[key].stats.cagr;
  const annuallyCagr  = results.annually.scenarios[key].stats.cagr;

  const el = document.getElementById("rebalCalloutText");
  const lines = [];

  // Find best and worst
  const vals = [
    { label: "No Rebalancing",       final: neverFinal,     cagr: neverCagr },
    { label: "Quarterly Rebalancing", final: quarterlyFinal, cagr: quarterlyCagr },
    { label: "Annual Rebalancing",    final: annuallyFinal,  cagr: annuallyCagr },
  ];
  vals.sort((a, b) => b.final - a.final);
  const best  = vals[0];
  const worst = vals[2];
  const spread = best.final - worst.final;

  lines.push(
    `<strong>${best.label}</strong> produced the highest final value at <strong>${fmt$.format(best.final)}</strong> (CAGR ${fmtPct(best.cagr)}), ` +
    `while <strong>${worst.label}</strong> finished at <strong>${fmt$.format(worst.final)}</strong> (CAGR ${fmtPct(worst.cagr)}).`
  );

  if (spread > 0) {
    lines.push(
      `The spread between best and worst rebalancing approach was <strong>${fmt$.format(spread)}</strong> in final portfolio value.`
    );
  }

  // Annual vs. quarterly comparison
  const annVsQtr = annuallyFinal - quarterlyFinal;
  if (Math.abs(annVsQtr) < 100) {
    lines.push(
      `Annual and quarterly rebalancing produced nearly identical results ` +
      `(<strong>${fmt$.format(annuallyFinal)}</strong> vs. <strong>${fmt$.format(quarterlyFinal)}</strong>).`
    );
  } else if (annVsQtr > 0) {
    lines.push(
      `Annual rebalancing outperformed quarterly by <strong>${fmt$.format(annVsQtr)}</strong>.`
    );
  } else {
    lines.push(
      `Quarterly rebalancing edged ahead of annual by <strong>${fmt$.format(-annVsQtr)}</strong>.`
    );
  }

  const driftLine = driftCalloutLine(results, best.label === "No Rebalancing");
  if (driftLine) lines.push(driftLine);

  el.innerHTML = lines.join("<br><br>");
}

// ==================== DRIFT & VOLATILITY PANEL ====================

// localStorage can throw (private mode, blocked site data) — never let that break the page
function storageGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}

const DRIFT_PANEL_KEY = "sg-rebal-drift-panel";
const FUND_MIX_COLORS = ["#7dd4e8", "#e8c020", "#4db8a0"];  // --color-data-1..3

let driftChart = null;
let volChart   = null;
let driftView  = "equity";    // equity | mix
let volView    = "implied";   // implied | realized
let driftDirty = true;        // data changed since the panel last rendered

const toTs = (d) => new Date(d + "T00:00:00Z").getTime();
const fmtMonth = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function driftPanelOpen() {
  return !document.getElementById("driftPanel").classList.contains("is-collapsed");
}

// Which of the 3 rebalancing lines are plotted (follows the stat-card checkboxes)
function rebalLineVisible(i) {
  const cb = document.querySelector(`.stat-card-toggle[data-dataset-idx="${i}"]`);
  return !cb || cb.checked;
}

// Drift objects for the selected strategy: [never, quarterly, annually]
function driftSeries(results) {
  const key = STRATEGIES[selectedStrategy].scenarioKey;
  return [results.never, results.quarterly, results.annually].map(r => r.scenarios[key] && r.scenarios[key].drift);
}

function driftFundSet(results) {
  const d = driftSeries(results)[0];
  const meta = results.ref.drift_meta;
  return d && meta ? meta.fund_sets[d.fund_set] : null;
}

function targetEquityPct(results) {
  const fs = driftFundSet(results);
  if (!fs) return null;
  return fs.equity_funds.reduce((s, f) => s + (fs.target_weights[f] || 0), 0) * 100;
}

// Yield-curve shading + crash markers on a linear (timestamp) x-axis, same look as the main chart
function driftAnnotations(results, x0, x1) {
  const ann = {};
  for (const p of (results.ref.yield_curve_inversions || [])) {
    const a = toTs(p.start), b = toTs(p.end);
    if (b < x0 || a > x1) continue;
    ann[`inv_${p.start}`] = {
      type: "box", xMin: Math.max(a, x0), xMax: Math.min(b, x1),
      backgroundColor: "rgba(220,38,38,0.07)", borderWidth: 0, drawTime: "beforeDatasetsDraw",
    };
  }
  const CRASHES = [
    { label: "Dot-com Peak",     target: "2001-03-31" },
    { label: "Financial Crisis", target: "2008-09-30" },
    { label: "COVID-19 Crash",   target: "2020-02-29" },
  ];
  for (const c of CRASHES) {
    const t = toTs(c.target);
    if (t < x0 || t > x1) continue;
    ann[c.label.replace(/\W+/g, "_")] = {
      type: "line", xMin: t, xMax: t,
      borderColor: "rgba(156,163,175,0.7)", borderWidth: 1, borderDash: [4, 4],
      label: {
        content: c.label, display: true, position: "start",
        backgroundColor: "rgba(100, 210, 230, 0.12)", color: "#5a9aaa",
        font: { size: 10 }, padding: 4, borderRadius: 3,
      },
    };
  }
  return ann;
}

// Shared options: timestamp x-axis spanning the main chart's date range, year ticks
function driftBaseOptions(x0, x1, yTickFmt) {
  const t = lightChart ? CHART_LIGHT : CHART_DARK;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: "nearest", axis: "x", intersect: false },
    plugins: {
      legend: {
        labels: {
          color: t.legendColor, font: { size: 12 }, boxWidth: 30, usePointStyle: true,
          generateLabels: (c) => {
            const items = Chart.defaults.plugins.legend.labels.generateLabels(c);
            items.forEach(it => { const ds = c.data.datasets[it.datasetIndex]; if (ds && ds.borderDash) it.lineDash = ds.borderDash; });
            return items;
          },
        },
      },
      tooltip: {
        backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, borderWidth: 1,
        titleColor: t.tooltipTitle, bodyColor: t.tooltipBody, padding: 10,
        // A rebalance date has two points (pre, post): keep one row per line
        filter: (item, i, items) => items.findIndex(o => o.datasetIndex === item.datasetIndex) === i,
        callbacks: { title: (items) => items.length ? fmtMonth(items[0].parsed.x) : "" },
      },
      annotation: { annotations: {} },
    },
    scales: {
      x: {
        type: "linear", min: x0, max: x1,
        afterBuildTicks: (scale) => {
          const y0 = new Date(x0).getUTCFullYear() + 1, y1 = new Date(x1).getUTCFullYear();
          const step = Math.max(1, Math.ceil((y1 - y0 + 1) / 10));
          const ticks = [];
          for (let y = y0; y <= y1; y += step) ticks.push({ value: Date.UTC(y, 0, 1) });
          scale.ticks = ticks;
        },
        ticks: { color: t.tickColor, font: { size: 11 }, maxRotation: 0, callback: (v) => String(new Date(v).getUTCFullYear()) },
        grid: { color: t.gridColor },
      },
      y: {
        ticks: { color: t.tickColor, font: { size: 11 }, callback: yTickFmt },
        grid: { color: t.gridColor },
      },
    },
  };
}

function lineDataset(i, colors, label, points) {
  return {
    label, data: points,
    borderColor: colors[i], backgroundColor: "transparent",
    borderWidth: REBAL_WIDTHS[i], borderDash: REBAL_DASHES[i],
    pointRadius: 0, pointStyle: "line", tension: 0, fill: false, spanGaps: false,
    hidden: !rebalLineVisible(i),
    rebalIdx: i,
  };
}

// Legend clicks on a strategy line go through its stat-card checkbox, so every chart stays in sync
function legendToCheckbox(e, item, legend) {
  const ds = legend.chart.data.datasets[item.datasetIndex];
  if (ds.rebalIdx === undefined) {
    const c = legend.chart;
    if (c.isDatasetVisible(item.datasetIndex)) c.hide(item.datasetIndex); else c.show(item.datasetIndex);
    return;
  }
  const cb = document.querySelector(`.stat-card-toggle[data-dataset-idx="${ds.rebalIdx}"]`);
  if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); }
}

function replaceChart(old, canvasId, config) {
  if (old) old.destroy();
  return new Chart(document.getElementById(canvasId).getContext("2d"), config);
}

function buildDriftChart(results) {
  const series = driftSeries(results);
  if (series.some(s => !s)) return;
  const colors = STRATEGIES[selectedStrategy].colors;
  const dates = results.ref.dates;
  const x0 = toTs(dates[0]), x1 = toTs(dates[dates.length - 1]);
  const target = targetEquityPct(results);
  const opts = driftBaseOptions(x0, x1, (v) => `${Math.round(v)}%`);
  opts.plugins.annotation.annotations = driftAnnotations(results, x0, x1);
  let datasets;

  if (driftView === "equity") {
    datasets = series.map((s, i) => lineDataset(i, colors, REBAL_LABELS[i],
      s.weight_dates.map((d, j) => ({ x: toTs(d), y: s.equity_pct[j] * 100 }))));
    // Auto-zoom, kept within 0–100 and always showing the target line
    const ys = datasets.filter(ds => !ds.hidden).flatMap(ds => ds.data.map(p => p.y)).concat([target]);
    // Round the range out to whole 5-point steps so the axis ends on clean ticks
    const lo = Math.min(...ys), hi = Math.max(...ys);
    opts.scales.y.min = Math.max(0, Math.floor((lo - 1) / 5) * 5);
    opts.scales.y.max = Math.min(100, Math.ceil((hi + 1) / 5) * 5);
    opts.plugins.annotation.annotations.target = {
      type: "line", yMin: target, yMax: target,
      borderColor: "rgba(232,192,32,0.75)", borderWidth: 1.5, borderDash: [2, 4],
      label: {
        content: `Target ${Math.round(target)}%`, display: true, position: "end", yAdjust: 12,
        backgroundColor: "rgba(232,192,32,0.15)", color: "#e8c020", font: { size: 10 }, padding: 4, borderRadius: 3,
      },
    };
    opts.plugins.legend.onClick = legendToCheckbox;
    opts.plugins.tooltip.itemSort = (a, b) => a.datasetIndex - b.datasetIndex;
    opts.plugins.tooltip.callbacks.label = (ctx) => {
      const gap = ctx.parsed.y - target;
      const next = ctx.dataset.data[ctx.dataIndex + 1];
      const reset = next && next.x === ctx.parsed.x ? " · rebalanced" : "";
      return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}% (${gap >= 0 ? "+" : ""}${gap.toFixed(1)})${reset}`;
    };
  } else {
    const idx = parseInt(document.getElementById("driftMixStrategy").value) || 0;
    const s = series[idx];
    // Flask sorts JSON keys, so take fund order (equity first, bond last) from the metadata
    const fs = driftFundSet(results);
    const funds = fs ? fs.funds.filter(f => f in s.weights) : Object.keys(s.weights);
    datasets = funds.map((f, k) => ({
      label: f,
      data: s.weight_dates.map((d, j) => ({ x: toTs(d), y: s.weights[f][j] * 100 })),
      borderColor: FUND_MIX_COLORS[k % FUND_MIX_COLORS.length],
      backgroundColor: hexToRgba(FUND_MIX_COLORS[k % FUND_MIX_COLORS.length], 0.45),
      borderWidth: 1, pointRadius: 0, pointStyle: "rect", tension: 0,
      fill: k === 0 ? "origin" : "-1",
    }));
    opts.scales.y.stacked = true;
    opts.scales.y.min = 0;
    opts.scales.y.max = 100;
    opts.plugins.tooltip.itemSort = (a, b) => a.datasetIndex - b.datasetIndex;
    opts.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`;
  }

  driftChart = replaceChart(driftChart, "driftChart", { type: "line", data: { datasets }, options: opts });
}

// Annualized rolling stdev of monthly returns; first W-1 months are null
function rollingVol(returns, W) {
  const out = new Array(returns.length).fill(null);
  for (let t = W - 1; t < returns.length; t++) {
    let mean = 0;
    for (let k = t - W + 1; k <= t; k++) mean += returns[k];
    mean /= W;
    let ss = 0;
    for (let k = t - W + 1; k <= t; k++) ss += (returns[k] - mean) ** 2;
    out[t] = Math.sqrt(12) * Math.sqrt(ss / (W - 1));
  }
  return out;
}

function buildVolChart(results) {
  const series = driftSeries(results);
  if (series.some(s => !s)) return;
  const colors = STRATEGIES[selectedStrategy].colors;
  const dates = results.ref.dates;
  const x0 = toTs(dates[0]), x1 = toTs(dates[dates.length - 1]);
  const opts = driftBaseOptions(x0, x1, (v) => `${(+v).toFixed(1)}%`);
  opts.plugins.annotation.annotations = driftAnnotations(results, x0, x1);
  opts.plugins.legend.onClick = legendToCheckbox;
  opts.plugins.tooltip.itemSort = (a, b) => a.datasetIndex - b.datasetIndex;
  let datasets;
  const showDiff = volView === "realized" && document.getElementById("volShowDiff").checked;

  if (volView === "implied") {
    datasets = series.map((s, i) => lineDataset(i, colors, REBAL_LABELS[i],
      s.weight_dates.map((d, j) => ({ x: toTs(d), y: s.implied_vol[j] * 100 }))));
  } else {
    const W = parseInt(document.getElementById("volWindow").value) || 36;
    const rv = series.map(s => rollingVol(s.monthly_returns, W));
    const pts = (vals, s) => s.return_dates.map((d, j) => ({ x: toTs(d), y: vals[j] === null ? null : vals[j] * 100 }));
    if (showDiff) {
      datasets = [1, 2].map(i => {
        const diff = rv[0].map((v, j) => (v === null || rv[i][j] === null) ? null : v - rv[i][j]);
        const ds = lineDataset(i, colors, `No Rebalancing − ${REBAL_LABELS[i].replace(" Rebalancing", "")}`, pts(diff, series[i]));
        ds.hidden = !(rebalLineVisible(i) && rebalLineVisible(0));
        return ds;
      });
      opts.plugins.annotation.annotations.zero = {
        type: "line", yMin: 0, yMax: 0, borderColor: "rgba(156,163,175,0.6)", borderWidth: 1,
      };
    } else {
      datasets = series.map((s, i) => lineDataset(i, colors, REBAL_LABELS[i], pts(rv[i], s)));
    }
  }
  opts.plugins.tooltip.callbacks.label = (ctx) => {
    const v = ctx.parsed.y;
    return ` ${ctx.dataset.label}: ${showDiff && v >= 0 ? "+" : ""}${v.toFixed(1)}${showDiff ? " pts" : "%"}`;
  };
  volChart = replaceChart(volChart, "volChart", { type: "line", data: { datasets }, options: opts });
}

function renderDriftPanel(force) {
  if (!lastResults || !driftPanelOpen()) return;  // lazy: nothing to draw while collapsed
  if (!driftDirty && !force) return;
  buildDriftChart(lastResults);
  buildVolChart(lastResults);
  applyDriftTheme();
  driftDirty = false;
}

// Called whenever new results arrive or the selected strategy changes
function invalidateDriftPanel() {
  driftDirty = true;
  renderDriftPanel();
}

// Stat-card checkbox changed: show/hide the matching lines without rebuilding
function syncDriftVisibility() {
  if (driftView === "equity") {
    // Rebuild so the auto-zoomed y-range follows the visible lines
    if (driftChart) buildDriftChart(lastResults);
  }
  if (volChart) {
    const diff = volView === "realized" && document.getElementById("volShowDiff").checked;
    volChart.data.datasets.forEach((ds, i) => {
      if (ds.rebalIdx === undefined) return;
      const vis = diff ? (rebalLineVisible(ds.rebalIdx) && rebalLineVisible(0)) : rebalLineVisible(ds.rebalIdx);
      volChart.getDatasetMeta(i).hidden = !vis;
    });
    volChart.update();
  }
}

function applyDriftTheme() {
  const t = lightChart ? CHART_LIGHT : CHART_DARK;
  document.querySelectorAll(".drift-chart-container").forEach(el => { el.style.background = t.containerBg; });
  for (const c of [driftChart, volChart]) {
    if (!c) continue;
    c.options.plugins.legend.labels.color     = t.legendColor;
    c.options.plugins.tooltip.backgroundColor = t.tooltipBg;
    c.options.plugins.tooltip.borderColor     = t.tooltipBorder;
    c.options.plugins.tooltip.titleColor      = t.tooltipTitle;
    c.options.plugins.tooltip.bodyColor       = t.tooltipBody;
    for (const ax of ["x", "y"]) {
      c.options.scales[ax].ticks.color = t.tickColor;
      c.options.scales[ax].grid.color  = t.gridColor;
    }
    c.update("none");
  }
}

function setSegSelected(toggleId, view) {
  document.querySelectorAll(`#${toggleId} .seg-option`).forEach(b => {
    b.classList.toggle("seg-option--selected", b.dataset.view === view);
  });
}

function wireDriftPanel() {
  const panel  = document.getElementById("driftPanel");
  const header = document.getElementById("driftPanelHeader");
  const setOpen = (open) => {
    panel.classList.toggle("is-collapsed", !open);
    header.setAttribute("aria-expanded", open ? "true" : "false");
  };
  setOpen(storageGet(DRIFT_PANEL_KEY) === "open");
  header.addEventListener("click", () => {
    const open = !driftPanelOpen();
    setOpen(open);
    storageSet(DRIFT_PANEL_KEY, open ? "open" : "collapsed");
    if (open) renderDriftPanel();
  });

  document.querySelectorAll("#driftViewToggle .seg-option").forEach(btn => {
    btn.addEventListener("click", () => {
      driftView = btn.dataset.view;
      setSegSelected("driftViewToggle", driftView);
      document.getElementById("driftMixStrategy").style.display = driftView === "mix" ? "" : "none";
      document.getElementById("driftCaption").textContent = driftView === "mix"
        ? "Each fund's share of the portfolio for one strategy, measured at each month-end before any rebalance."
        : "Share of the portfolio in stock funds, measured at each month-end before any rebalance. On rebalancing dates the line drops straight back to target.";
      if (lastResults) buildDriftChart(lastResults), applyDriftTheme();
    });
  });
  document.getElementById("driftMixStrategy").addEventListener("change", () => {
    if (lastResults) buildDriftChart(lastResults), applyDriftTheme();
  });

  document.querySelectorAll("#volViewToggle .seg-option").forEach(btn => {
    btn.addEventListener("click", () => {
      volView = btn.dataset.view;
      setSegSelected("volViewToggle", volView);
      document.getElementById("volRealizedControls").style.display = volView === "realized" ? "" : "none";
      document.getElementById("volCaption").textContent = volView === "realized"
        ? "Volatility the portfolio actually experienced. Market conditions dominate; treat small gaps as noise."
        : "Volatility the current mix would have under average market conditions. Rebalancing holds this steady; drift lets it rise.";
      if (lastResults) buildVolChart(lastResults), applyDriftTheme();
    });
  });
  // Window slider: recomputed client-side from monthly_returns, no server call
  document.getElementById("volWindow").addEventListener("input", (e) => {
    document.getElementById("volWindowLabel").textContent = `${e.target.value}-month window`;
    if (lastResults) buildVolChart(lastResults), applyDriftTheme();
  });
  document.getElementById("volShowDiff").addEventListener("change", () => {
    if (lastResults) buildVolChart(lastResults), applyDriftTheme();
  });

  document.querySelectorAll(".drift-snap-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const c = btn.dataset.chart === "drift" ? driftChart : volChart;
      if (!c) return;
      const link = document.createElement("a");
      link.download = btn.dataset.chart === "drift" ? "allocation-drift.png" : "portfolio-volatility.png";
      link.href = c.toBase64Image();
      link.click();
    });
  });
}

// Summary-box sentence: where No Rebalancing ended vs. target
function driftCalloutLine(results, neverIsBest) {
  const never = driftSeries(results)[0];
  const target = targetEquityPct(results);
  if (!never || target === null || !never.equity_pct.length) return null;
  const end = never.equity_pct[never.equity_pct.length - 1] * 100;
  const tgt = Math.round(target);
  if (Math.abs(end - target) < 2) {
    return `No Rebalancing stayed close to its ${tgt}% stock target (ended at ${Math.round(end)}%).`;
  }
  const article = /^(8|11$|18$)/.test(String(tgt)) ? "an" : "a";  // "an 80%", "an 11%", "a 60%"
  let line = `No Rebalancing ended at <strong>${Math.round(end)}% stocks</strong> vs. ${article} ${tgt}% target`;
  if (neverIsBest && end > target) line += ", so its higher final value came with more risk";
  return line + ".";
}

// ==================== FETCH & RENDER ====================

function getParams() {
  return {
    initial_amount:  document.getElementById("initialAmount").value,
    monthly_contrib: document.getElementById("monthlyContrib").value,
    start_date:      document.getElementById("startDate").value,
    end_date:        document.getElementById("endDate").value,
    stock_pct:       document.getElementById("stockPct").value,
    aum_fee:         document.getElementById("aumFee").value,
    inflation_adj:   document.getElementById("inflationAdj").checked ? "true" : "false",
    active_fund_set: document.getElementById("activeFundSet").value,
    diy_portfolio:   document.getElementById("diyPortfolio").value,
    aggressiveness:  document.querySelector("input[name='aggressiveness']:checked")?.value || "moderate",
    taxable:         document.querySelector("input[name='taxable']:checked")?.value ?? "true",
  };
}

function validateInputs() {
  const fields = [
    { id: "initialAmount",  label: "Starting Amount",      min: 1,      max: 10_000_000 },
    { id: "monthlyContrib", label: "Monthly Contribution", min: 0,      max: 100_000 },
    { id: "aumFee",         label: "Advisor Fee",          min: 0,      max: 10 },
  ];
  for (const { id, label, min, max } of fields) {
    const raw = document.getElementById(id).value.trim();
    const v = parseFloat(raw);
    if (raw === "" || isNaN(v)) return `${label}: please enter a number.`;
    if (v < min) return `${label}: minimum value is ${min.toLocaleString()}.`;
    if (v > max) return `${label}: maximum value is ${max.toLocaleString()}.`;
  }
  return null;
}

let suppressPickerFetch = false;

async function fetchAndRender() {
  const overlay = document.getElementById("loadingOverlay");
  const errBanner = document.getElementById("errorBanner");
  errBanner.style.display = "none";

  const validationError = validateInputs();
  if (validationError) {
    errBanner.textContent = validationError;
    errBanner.style.display = "block";
    return;
  }

  overlay.style.display = "flex";
  const baseParams = getParams();

  try {
    // 3 parallel API calls — one per rebalancing frequency
    const responses = await Promise.all(
      REBAL_MODES.map(mode => {
        const params = { ...baseParams, rebalance: mode, include_drift: "true" };
        const qs = new URLSearchParams(params).toString();
        return fetch(`/api/portfolio?${qs}`).then(r => r.json());
      })
    );

    const [neverData, quarterlyData, annuallyData] = responses;
    const refData = annuallyData;

    if (!refData.scenarios) {
      throw new Error(refData.error || "Server error");
    }

    suppressPickerFetch = true;
    initDatePicker(refData.meta.absolute_date_start, refData.meta.absolute_date_end);
    suppressPickerFetch = false;

    document.getElementById("dateRangeNote").textContent =
      `Common history: ${refData.meta.date_range_start} → ${refData.meta.date_range_end} (${refData.meta.months_available} months)`;

    if (refData.error) {
      errBanner.textContent = refData.error;
      errBanner.style.display = "block";
    }

    lastResults = {
      never:     neverData,
      quarterly: quarterlyData,
      annually:  annuallyData,
      ref:       refData,
    };

    buildChart(lastResults);
    handleScaleAfterRender(lastResults);
    updateStats(lastResults);
    updateCallout(lastResults);
    invalidateDriftPanel();

  } catch (err) {
    errBanner.textContent = `Error: ${err.message}`;
    errBanner.style.display = "block";
  } finally {
    overlay.style.display = "none";
  }
}

const debouncedFetch = debounce(fetchAndRender, 400);

// ==================== ACCOUNT TYPE ====================

function setTaxable(value) {
  document.querySelectorAll("#taxToggle .agg-option").forEach(el => {
    const radio = el.querySelector("input[name='taxable']");
    if (!radio) return;
    radio.checked = radio.value === value;
    el.classList.toggle("agg-option--selected", radio.value === value);
  });
}

// ==================== AGGRESSIVENESS ====================

function setAggressiveness(value) {
  document.querySelectorAll("#aggToggle .agg-option").forEach(el => {
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
  document.getElementById("diyPortfolio").value = era;
  document.getElementById("diyFundDisplay").textContent = config.diyTickers.join(" / ");

  document.querySelectorAll("input[name='era']").forEach(radio => {
    radio.checked = (radio.value === era);
  });
  document.querySelectorAll(".era-option").forEach(el => {
    el.classList.toggle("era-option--selected", el.querySelector("input[name='era']").value === era);
  });

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

  pickerYear  = null;
  pickerMonth = null;
  document.getElementById("startDate").value = "";
}

// ==================== DATE PICKER ====================

let pickerYear  = null;
let pickerMonth = null;
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

function toSeq(y, m) { return y * 12 + m; }

function updatePickerDisplay() {
  const startSeq = toSeq(pickerYear, pickerMonth);
  const minSeq   = toSeq(pickerMinYear, pickerMinMonth);
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
  if (input.value !== val) { input.value = val; if (!suppressPickerFetch) debouncedFetch(); }
}

function updateEndPickerDisplay() {
  const endSeq   = toSeq(endPickerYear, endPickerMonth);
  const maxSeq   = toSeq(pickerMaxYear, pickerMaxMonth);
  const startSeq = toSeq(pickerYear ?? pickerMinYear, pickerMonth ?? pickerMinMonth);
  const effMinSeq = startSeq + 1;

  document.getElementById("endPickerYear").textContent  = endPickerYear  ?? "—";
  document.getElementById("endPickerMonth").textContent = endPickerMonth ? MONTH_NAMES[endPickerMonth - 1] : "—";

  document.getElementById("endPickerPrevYear").disabled  = endPickerYear  <= Math.ceil(effMinSeq / 12);
  document.getElementById("endPickerNextYear").disabled  = endPickerYear  >= pickerMaxYear;
  document.getElementById("endPickerPrevMonth").disabled = endSeq         <= effMinSeq;
  document.getElementById("endPickerNextMonth").disabled = endSeq         >= maxSeq;
  document.getElementById("endPickerReset").style.display = endSeq < maxSeq ? "inline-block" : "none";

  const val = endSeq < maxSeq ? pickerToYYYYMM(endPickerYear, endPickerMonth) : "";
  const input = document.getElementById("endDate");
  if (input.value !== val) { input.value = val; if (!suppressPickerFetch) debouncedFetch(); }
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
  const [sy, sm] = absStart.split("-").map(Number);
  const [ey, em] = absEnd.split("-").map(Number);
  pickerMinYear  = sy;
  pickerMinMonth = sm;
  pickerMaxYear  = ey;
  pickerMaxMonth = em;

  if (pickerYear    === null) { pickerYear  = sy; pickerMonth  = sm; }
  if (endPickerYear === null) { endPickerYear = ey; endPickerMonth = em; }

  clampPicker();
  clampEndPicker();
  updatePickerDisplay();
  updateEndPickerDisplay();
}

function showPickerDropdown(anchorEl, items, currentValue, onSelect) {
  document.querySelectorAll(".picker-dropdown").forEach(d => d.remove());
  const dropdown = document.createElement("div");
  dropdown.className = "picker-dropdown";
  items.forEach(item => {
    const div = document.createElement("div");
    div.className = "picker-dropdown-item";
    if (item.value === currentValue) div.classList.add("active");
    div.textContent = item.label;
    div.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(item.value);
      dropdown.remove();
    });
    dropdown.appendChild(div);
  });
  anchorEl.appendChild(dropdown);
  const activeItem = dropdown.querySelector(".active");
  if (activeItem) activeItem.scrollIntoView({ block: "center" });
  setTimeout(() => {
    document.addEventListener("click", function handler(e) {
      if (!dropdown.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener("click", handler);
      }
    });
  });
}

function movePickerYear(delta)  { pickerYear += delta; clampPicker(); updatePickerDisplay(); updateEndPickerDisplay(); }
function movePickerMonth(delta) {
  pickerMonth += delta;
  if (pickerMonth < 1)  { pickerYear -= 1; pickerMonth = 12; }
  if (pickerMonth > 12) { pickerYear += 1; pickerMonth = 1;  }
  clampPicker(); updatePickerDisplay(); updateEndPickerDisplay();
}
function moveEndPickerYear(delta) { endPickerYear += delta; clampEndPicker(); updateEndPickerDisplay(); updatePickerDisplay(); }
function moveEndPickerMonth(delta) {
  endPickerMonth += delta;
  if (endPickerMonth < 1)  { endPickerYear -= 1; endPickerMonth = 12; }
  if (endPickerMonth > 12) { endPickerYear += 1; endPickerMonth = 1;  }
  clampEndPicker(); updateEndPickerDisplay(); updatePickerDisplay();
}

// ==================== WIRE UP INPUTS ====================

function wireInputs() {
  const ids = [
    "initialAmount", "monthlyContrib", "stockPct",
    "aumFee", "inflationAdj", "activeFundSet",
  ];

  for (const id of ids) {
    document.getElementById(id).addEventListener("input", debouncedFetch);
    document.getElementById(id).addEventListener("change", debouncedFetch);
  }

  // Strategy radio buttons — re-render from cache, no re-fetch
  document.querySelectorAll("input[name='strategy']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      setStrategy(e.target.value);
    });
  });

  // Era radio buttons
  document.querySelectorAll("input[name='era']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      setEra(e.target.value);
      debouncedFetch();
    });
  });

  // Account Type
  document.querySelectorAll("input[name='taxable']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      setTaxable(e.target.value);
      debouncedFetch();
    });
  });

  // Aggressiveness
  document.querySelectorAll("input[name='aggressiveness']").forEach(radio => {
    radio.addEventListener("change", (e) => {
      setAggressiveness(e.target.value);
      debouncedFetch();
    });
  });

  // Date pickers
  document.getElementById("pickerPrevYear").addEventListener("click",  () => movePickerYear(-1));
  document.getElementById("pickerNextYear").addEventListener("click",  () => movePickerYear(+1));
  document.getElementById("pickerPrevMonth").addEventListener("click", () => movePickerMonth(-1));
  document.getElementById("pickerNextMonth").addEventListener("click", () => movePickerMonth(+1));

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

  // Date picker dropdown click handlers
  document.getElementById("pickerYear").addEventListener("click", (e) => {
    e.stopPropagation();
    const effMaxSeq = toSeq(endPickerYear ?? pickerMaxYear, endPickerMonth ?? pickerMaxMonth) - 1;
    const maxY = Math.floor((effMaxSeq - 1) / 12);
    const items = [];
    for (let y = pickerMinYear; y <= maxY; y++) items.push({ value: y, label: String(y) });
    showPickerDropdown(e.currentTarget, items, pickerYear, (val) => {
      pickerYear = val; clampPicker(); updatePickerDisplay(); updateEndPickerDisplay();
    });
  });
  document.getElementById("pickerMonth").addEventListener("click", (e) => {
    e.stopPropagation();
    const items = MONTH_NAMES.map((name, i) => ({ value: i + 1, label: name }));
    showPickerDropdown(e.currentTarget, items, pickerMonth, (val) => {
      pickerMonth = val; clampPicker(); updatePickerDisplay(); updateEndPickerDisplay();
    });
  });
  document.getElementById("endPickerYear").addEventListener("click", (e) => {
    e.stopPropagation();
    const effMinSeq = toSeq(pickerYear ?? pickerMinYear, pickerMonth ?? pickerMinMonth) + 1;
    const minY = Math.ceil(effMinSeq / 12);
    const items = [];
    for (let y = minY; y <= pickerMaxYear; y++) items.push({ value: y, label: String(y) });
    showPickerDropdown(e.currentTarget, items, endPickerYear, (val) => {
      endPickerYear = val; clampEndPicker(); updateEndPickerDisplay(); updatePickerDisplay();
    });
  });
  document.getElementById("endPickerMonth").addEventListener("click", (e) => {
    e.stopPropagation();
    const items = MONTH_NAMES.map((name, i) => ({ value: i + 1, label: name }));
    showPickerDropdown(e.currentTarget, items, endPickerMonth, (val) => {
      endPickerMonth = val; clampEndPicker(); updateEndPickerDisplay(); updatePickerDisplay();
    });
  });

  // Stat card visibility toggles
  document.querySelectorAll(".stat-card-toggle").forEach(cb => {
    cb.addEventListener("change", (e) => {
      if (!chart) return;
      const idx = parseInt(e.target.dataset.datasetIdx);
      if (idx < chart.data.datasets.length) {
        chart.getDatasetMeta(idx).hidden = !e.target.checked;
      }
      e.target.title = e.target.checked ? "Uncheck to hide this line on the chart" : "Check to show this line on the chart";
      e.target.closest(".stat-card").classList.toggle("line-hidden", !e.target.checked);
      chart.update();
      syncDriftVisibility();
    });
  });

  // Show total invested
  document.getElementById("showContrib").addEventListener("change", (e) => {
    if (!chart) return;
    const idx = chart.data.datasets.findIndex(ds => ds.label === "Total Invested");
    if (idx === -1) return;
    chart.getDatasetMeta(idx).hidden = !e.target.checked;
    chart.update();
  });

  // Show after-tax wealth
  document.getElementById("showAfterTax").addEventListener("change", () => {
    if (!lastResults) return;
    buildChart(lastResults);
  });

  // Show momentum rotation
  document.getElementById("showMomentum").addEventListener("change", (e) => {
    setAggEnabled(e.target.checked);
    document.getElementById("momentumStats").style.display = e.target.checked ? "block" : "none";
    if (!chart || !lastResults) return;
    buildChart(lastResults);
  });

  // Log scale toggle
  document.getElementById("logScale").addEventListener("change", (e) => {
    if (!chart) return;
    chart.options.scales.y.type = e.target.checked ? "logarithmic" : "linear";
    chart.update();
  });

  // Scale lock
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

  // Chart theme toggle
  document.getElementById("chartThemeBtn").addEventListener("click", () => {
    lightChart = !lightChart;
    applyChartTheme(lightChart);
  });

  // Save chart as PNG
  document.getElementById("chartSnapBtn").addEventListener("click", () => {
    if (!chart) return;
    const link = document.createElement("a");
    link.download = "rebalancing-impact.png";
    link.href = chart.toBase64Image();
    link.click();
  });

  // Rescale button
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

  // Slider display update
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
  setTimeout(() => { if (chart) chart.resize(); }, 260);
});

// ==================== COLLAPSIBLE SIDEBAR GROUPS ====================
{
  const GROUP_TOOLTIPS = {
    'group-simulation': 'Set your starting balance, contributions, date range, and strategy to compare.',
    'group-portfolio':  'Choose index vs. active funds, investment era, and advisor fee assumptions.',
    'group-display':    'Control tax treatment, inflation adjustment, and which chart lines are shown.',
  };

  document.querySelectorAll('.sidebar-group').forEach(group => {
    const btn     = group.querySelector('.sidebar-group-header');
    const tip     = group.id && GROUP_TOOLTIPS[group.id];

    const saved = localStorage.getItem('sg-rebal-' + group.id);
    if (saved === 'collapsed') group.classList.add('is-collapsed');

    if (tip) btn.title = tip;

    btn.addEventListener('click', () => {
      const collapsed = group.classList.toggle('is-collapsed');
      localStorage.setItem('sg-rebal-' + group.id, collapsed ? 'collapsed' : 'open');
    });
  });
}

// ==================== SIDEBAR TOOLTIPS ====================
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
wireDriftPanel();
fetchAndRender();
