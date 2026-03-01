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

function buildChart(data) {
  const ctx = document.getElementById("mainChart").getContext("2d");

  const labels = data.dates;

  const diyVals           = data.scenarios.diy.values;
  const managedVals       = data.scenarios.managed.values;
  const activeVals        = data.scenarios.active.values;
  const activeManagedVals = data.scenarios.active_managed.values;

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
            filter: (item) => item.text !== "_fill",
            font: { size: 12 },
            boxWidth: 20,
            usePointStyle: true,
          },
        },
        tooltip: {
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

  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets.forEach((ds, i) => {
      if (datasets[i]) {
        ds.data  = datasets[i].data;
        ds.label = datasets[i].label;
      }
    });
    chart.options.plugins.annotation.annotations = annotations;
    chart.update();
  } else {
    chart = new Chart(ctx, config);
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

  fill("diy",           s.diy.stats);
  fill("managed",       s.managed.stats);
  fill("active",        s.active.stats);
  fill("activeManaged", s.active_managed.stats);

  // Update active card subtitles to reflect selected fund family
  const desc = data.active_fund_set.description;
  document.getElementById("activeCardSub").textContent        = desc;
  document.getElementById("activeManagedCardSub").textContent = `${desc} + advisor fees`;
}

function updateFeeDrag(data) {
  const fd = data.fee_drag;
  const el = document.getElementById("feeDragText");

  const lines = [];

  // DIY vs Fee-Managed
  if (fd.diy_vs_managed >= 0) {
    lines.push(`DIY Index outperformed Fee-Adjusted Managed by <strong>${fmt$.format(fd.diy_vs_managed)}</strong> — money lost to advisor and fund fees.`);
  } else {
    lines.push(`Fee-Adjusted Managed outperformed DIY by <strong>${fmt$.format(Math.abs(fd.diy_vs_managed))}</strong> in this period.`);
  }

  // DIY vs Active
  if (fd.diy_vs_active >= 0) {
    lines.push(`DIY Index outperformed Actively Managed by <strong>${fmt$.format(fd.diy_vs_active)}</strong> over the same period.`);
  } else {
    lines.push(`Actively Managed outperformed DIY by <strong>${fmt$.format(Math.abs(fd.diy_vs_active))}</strong> — active management added value in this period.`);
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
    years:           document.getElementById("years").value,
    stock_pct:       document.getElementById("stockPct").value,
    rebalance:       document.getElementById("rebalance").value,
    aum_fee:         document.getElementById("aumFee").value,
    expense_ratio:   document.getElementById("expenseRatio").value,
    inflation_adj:   document.getElementById("inflationAdj").checked ? "true" : "false",
    active_fund_set: document.getElementById("activeFundSet").value,
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

    // Update year slider max
    const yearsSlider = document.getElementById("years");
    const yearsAvail  = data.meta.years_available;
    if (yearsAvail && parseInt(yearsSlider.max) !== yearsAvail) {
      yearsSlider.max = yearsAvail;
      document.getElementById("yearsMax").textContent = `${yearsAvail} yrs`;
    }

    // Date range note
    document.getElementById("dateRangeNote").textContent =
      `Common history: ${data.meta.date_range_start} → ${data.meta.date_range_end} (${data.meta.months_available} months)`;

    // Soft warning
    if (data.error) {
      errBanner.textContent = data.error;
      errBanner.style.display = "block";
    }

    buildChart(data);
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

// ==================== WIRE UP INPUTS ====================

function wireInputs() {
  const ids = [
    "initialAmount", "monthlyContrib", "years", "stockPct",
    "rebalance", "aumFee", "expenseRatio", "inflationAdj", "activeFundSet",
  ];

  for (const id of ids) {
    document.getElementById(id).addEventListener("input", debouncedFetch);
    document.getElementById(id).addEventListener("change", debouncedFetch);
  }

  // Slider display updates (instant, no debounce)
  document.getElementById("years").addEventListener("input", (e) => {
    document.getElementById("yearsDisplay").textContent = e.target.value;
  });
  document.getElementById("stockPct").addEventListener("input", (e) => {
    document.getElementById("stockPctDisplay").textContent = e.target.value;
  });
}

// ==================== INIT ====================

wireInputs();
fetchAndRender();
