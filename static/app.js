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

// ==================== CHART SETUP ====================

let chart = null;
let scaleLocked = false;
let lockedYMin  = null;
let lockedYMax  = null;
let lastData    = null;

function getDataExtremes(data) {
  const allVals = [
    ...data.scenarios.diy.values,
    ...data.scenarios.managed.values,
    ...data.scenarios.active.values,
    ...data.scenarios.active_managed.values,
  ];
  if (document.getElementById("showMomentum").checked) {
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

function buildChart(data) {
  const ctx = document.getElementById("mainChart").getContext("2d");

  const labels = data.dates;

  const diyVals            = data.scenarios.diy.values;
  const managedVals        = data.scenarios.managed.values;
  const activeVals         = data.scenarios.active.values;
  const activeManagedVals  = data.scenarios.active_managed.values;
  const diyMomentumVals    = data.scenarios.diy_momentum.values;
  const activeMomentumVals = data.scenarios.active_momentum.values;
  const momentumVisible    = document.getElementById("showMomentum").checked;

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
        backgroundColor: "rgba(255,255,255,0.85)",
        color: "#6b7280",
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
      label: data.scenarios.diy_momentum.label,
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
      label: data.scenarios.active_momentum.label,
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
          labels: {
            filter: (item) => {
              if (item.text === "_fill") return false;
              if (item.text === "Total Invested") return document.getElementById("showContrib").checked;
              if (item.text.includes("Momentum")) return document.getElementById("showMomentum").checked;
              return true;
            },
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
          grid: { color: "rgba(0,0,0,0.04)" },
        },
        y: {
          ticks: {
            callback: (v) => fmt$.format(v),
            font: { size: 11 },
          },
          grid: { color: "rgba(0,0,0,0.04)" },
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
    const diyMomIdx = chart.data.datasets.findIndex(ds => ds.label === datasets[6].label);
    if (diyMomIdx !== -1) chart.getDatasetMeta(diyMomIdx).hidden = !momentumVisible;
    const actMomIdx = chart.data.datasets.findIndex(ds => ds.label === datasets[7].label);
    if (actMomIdx !== -1) chart.getDatasetMeta(actMomIdx).hidden = !momentumVisible;
    chart.update();
  } else {
    chart = new Chart(ctx, config);
    // Hide contrib line on initial render if checkbox is unchecked
    const contribIdx = chart.data.datasets.findIndex(ds => ds.label === "Total Invested");
    if (contribIdx !== -1) {
      chart.getDatasetMeta(contribIdx).hidden = !contribVisible;
      chart.update("none");
    }
  }
}

// ==================== STATS ====================

function updateStats(data) {
  const s = data.scenarios;

  function fill(prefix, stats) {
    document.getElementById(`${prefix}Final`).textContent   = fmt$.format(stats.final_value);
    document.getElementById(`${prefix}Contrib`).textContent = fmt$.format(stats.total_contributions);
    document.getElementById(`${prefix}Gain`).textContent    = fmt$.format(stats.total_gain);
    document.getElementById(`${prefix}Cagr`).textContent    = fmtPct(stats.cagr);
    document.getElementById(`${prefix}Fees`).textContent    = fmt$.format(stats.total_fees_paid);
  }

  fill("diy",            s.diy.stats);
  fill("managed",        s.managed.stats);
  fill("active",         s.active.stats);
  fill("activeManaged",  s.active_managed.stats);
  fill("diyMomentum",    s.diy_momentum.stats);
  fill("activeMomentum", s.active_momentum.stats);

  // Update DIY and managed card subtitles
  const diyDesc = data.diy_portfolio.description;
  document.getElementById("diyCardSub").textContent          = diyDesc;
  document.getElementById("managedCardSub").textContent      = `${diyDesc} + advisor fees`;
  document.getElementById("diyMomentumCardSub").textContent  = `${diyDesc} · annual momentum rotation`;

  // Update active card subtitles to reflect selected fund family
  const desc = data.active_fund_set.description;
  document.getElementById("activeCardSub").textContent             = desc;
  document.getElementById("activeManagedCardSub").textContent      = `${desc} + advisor fees`;
  document.getElementById("activeMomentumCardSub").textContent     = "AGTHX / ANWPX / ABNDX · annual momentum rotation";

  // Update weighted expense ratio display
  const wer = data.active_fund_set.weighted_expense_ratio;
  document.getElementById("erDisplay").textContent = `${wer.toFixed(2)}% / yr`;
}

function updateFeeDrag(data) {
  const fd = data.fee_drag;
  const el = document.getElementById("feeDragText");

  const lines = [];

  // DIY vs Fee-Managed
  if (fd.diy_vs_managed >= 0) {
    lines.push(`Low-Cost Index outperformed Fee-Adjusted Index by <strong>${fmt$.format(fd.diy_vs_managed)}</strong> — money lost to advisor and fund fees.`);
  } else {
    lines.push(`Fee-Adjusted Index outperformed Low-Cost Index by <strong>${fmt$.format(Math.abs(fd.diy_vs_managed))}</strong> in this period.`);
  }

  // DIY vs Active
  if (fd.diy_vs_active >= 0) {
    lines.push(`Low-Cost Index outperformed Actively Managed by <strong>${fmt$.format(fd.diy_vs_active)}</strong> over the same period.`);
  } else {
    lines.push(`Actively Managed outperformed Low-Cost Index by <strong>${fmt$.format(Math.abs(fd.diy_vs_active))}</strong> — active management added value in this period.`);
  }

  // Active vs Fee-Adjusted Active
  if (fd.active_vs_active_managed >= 0) {
    lines.push(`Applying advisor fees to the active portfolio cost <strong>${fmt$.format(fd.active_vs_active_managed)}</strong> versus the no-fee active baseline.`);
  } else {
    lines.push(`Fee-Adjusted Active outperformed no-fee Active by <strong>${fmt$.format(Math.abs(fd.active_vs_active_managed))}</strong> (unexpected in this period).`);
  }

  el.innerHTML = lines.join("<br />");
}

// ==================== FETCH & RENDER ====================

function getParams() {
  return {
    initial_amount: document.getElementById("initialAmount").value,
    monthly_contrib: document.getElementById("monthlyContrib").value,
    start_date:      document.getElementById("startDate").value,
    stock_pct:       document.getElementById("stockPct").value,
    rebalance:       document.getElementById("rebalance").value,
    aum_fee:         document.getElementById("aumFee").value,
    inflation_adj:   document.getElementById("inflationAdj").checked ? "true" : "false",
    active_fund_set: document.getElementById("activeFundSet").value,
    diy_portfolio:   document.getElementById("diyPortfolio").value,
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

// ==================== ERA SELECTION ====================

const ERA_CONFIG = {
  etf: {
    diyDisplay: "VTI / VXUS / BND",
    activeFunds: [
      { value: "american_dodge",  label: "American/Dodge — AGTHX / DODFX / PTTAX" },
      { value: "fidelity",        label: "Fidelity — FCNTX / FIEUX / FTBFX" },
      { value: "vanguard_active", label: "Vanguard Active — VWUSX / VWILX / VBTLX" },
      { value: "t_rowe_price",    label: "T. Rowe Price — PRGFX / PRITX / PRTIX" },
    ],
  },
  pre_etf: {
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

  // Update DIY fund display
  document.getElementById("diyFundDisplay").textContent = config.diyDisplay;

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
let pickerMinYear  = null;
let pickerMinMonth = null;
let pickerMaxYear  = null;
let pickerMaxMonth = null;

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function pickerToYYYYMM(y, m) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function updatePickerDisplay() {
  const atMin = pickerYear === pickerMinYear && pickerMonth <= pickerMinMonth;
  const atMax = pickerYear === pickerMaxYear && pickerMonth >= pickerMaxMonth;
  const atMinYear = pickerYear <= pickerMinYear;
  const atMaxYear = pickerYear >= pickerMaxYear;

  document.getElementById("pickerYear").textContent  = pickerYear  ?? "—";
  document.getElementById("pickerMonth").textContent = pickerMonth ? MONTH_NAMES[pickerMonth - 1] : "—";

  document.getElementById("pickerPrevYear").disabled  = atMinYear;
  document.getElementById("pickerNextYear").disabled  = atMaxYear;
  document.getElementById("pickerPrevMonth").disabled = atMin;
  document.getElementById("pickerNextMonth").disabled = atMax;

  // Write hidden input and trigger fetch
  const val = (pickerYear && pickerMonth) ? pickerToYYYYMM(pickerYear, pickerMonth) : "";
  const input = document.getElementById("startDate");
  if (input.value !== val) {
    input.value = val;
    debouncedFetch();
  }
}

function clampPicker() {
  if (pickerYear < pickerMinYear || (pickerYear === pickerMinYear && pickerMonth < pickerMinMonth)) {
    pickerYear  = pickerMinYear;
    pickerMonth = pickerMinMonth;
  }
  if (pickerYear > pickerMaxYear || (pickerYear === pickerMaxYear && pickerMonth > pickerMaxMonth)) {
    pickerYear  = pickerMaxYear;
    pickerMonth = pickerMaxMonth;
  }
}

function initDatePicker(absStart, absEnd) {
  // absStart / absEnd are "YYYY-MM-DD" strings
  const [sy, sm] = absStart.split("-").map(Number);
  const [ey, em] = absEnd.split("-").map(Number);
  pickerMinYear  = sy;
  pickerMinMonth = sm;
  pickerMaxYear  = ey;
  pickerMaxMonth = em;

  // Default to earliest available on first load only
  if (pickerYear === null) {
    pickerYear  = sy;
    pickerMonth = sm;
  }
  clampPicker();
  updatePickerDisplay();
}

function movePickerYear(delta) {
  pickerYear += delta;
  clampPicker();
  updatePickerDisplay();
}

function movePickerMonth(delta) {
  pickerMonth += delta;
  if (pickerMonth < 1)  { pickerYear -= 1; pickerMonth = 12; }
  if (pickerMonth > 12) { pickerYear += 1; pickerMonth = 1;  }
  clampPicker();
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

  // Date picker arrow buttons
  document.getElementById("pickerPrevYear").addEventListener("click",  () => movePickerYear(-1));
  document.getElementById("pickerNextYear").addEventListener("click",  () => movePickerYear(+1));
  document.getElementById("pickerPrevMonth").addEventListener("click", () => movePickerMonth(-1));
  document.getElementById("pickerNextMonth").addEventListener("click", () => movePickerMonth(+1));

  // Show total invested checkbox
  document.getElementById("showContrib").addEventListener("change", (e) => {
    if (!chart) return;
    const idx = chart.data.datasets.findIndex(ds => ds.label === "Total Invested");
    if (idx === -1) return;
    chart.getDatasetMeta(idx).hidden = !e.target.checked;
    chart.update();
  });

  // Show momentum rotation checkbox
  document.getElementById("showMomentum").addEventListener("change", (e) => {
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

// ==================== INIT ====================

setEra("etf");
wireInputs();
fetchAndRender();
