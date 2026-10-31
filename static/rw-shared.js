/* ==========================================================================
   rw-shared.js — Shared constants and pure functions for rolling-window pages
   ========================================================================== */

// ── Era definitions ────────────────────────────────────────────────────────
const RW_ERAS = [
  { key: 'pre_etf', label: 'Pre-ETF (1987–)', tickers: ['VFINX','VWIGX','VBMFX'] },
  { key: 'etf',     label: 'ETF (2011–)',      tickers: ['VTI','VXUS','BND']      },
];

const RW_DEFAULTS = {
  era:          'pre_etf',
  stockPct:     80,
  domesticPct:  80,   // % of equity that is US domestic (matches dashboard's 80/20 rule)
  rebalance:    'annually',
  windowMonths: 60,
};

// Within-equity domestic/international split — must match simulator.py and the dashboard.
// "X% stocks" → EQUITY_DOMESTIC_FRAC*X% domestic + (1-EQUITY_DOMESTIC_FRAC)*X% international.
const EQUITY_DOMESTIC_FRAC = 0.80;

const MIN_WINDOW_MONTHS = 12;   // 1 yr — below this CAGR annualization gets wild
const MAX_WINDOW_MONTHS = 240;  // 20 yr cap
const LTCG_RATE = 0.20;         // long-term capital gains rate for end-of-window tax drag

// ── Color scales ───────────────────────────────────────────────────────────
const COLORSCALE = [
  [0,   '#1D9E75'],
  [0.5, '#7dd4e8'],
  [1,   '#e8c020'],
];

const QUALITY_COLORSCALE = [
  [0,   '#d64545'],
  [0.5, '#b0a840'],
  [1,   '#3cb850'],
];

// Fixed per-axis quality breakpoints
const VOL_GREEN  = 6;   // vol (%) → green (low risk)
const VOL_RED    = 18;  // vol (%) → red (high risk)
const CAGR_RED   = 0;   // CAGR (%) → red
const CAGR_GREEN = 15;  // CAGR (%) → green


// ── Pure portfolio / window functions ──────────────────────────────────────

/**
 * Compute portfolio allocation weights.
 * Matches simulator.py:compute_weights exactly.
 *   tickers = [us_equity, intl_equity, bond]
 *   domesticFrac: fraction of equity that is domestic (default EQUITY_DOMESTIC_FRAC = 0.80)
 */
function computeWeights(stockPct, tickers, domesticFrac) {
  const df = domesticFrac !== undefined ? domesticFrac : EQUITY_DOMESTIC_FRAC;
  const s = stockPct / 100, b = 1 - s;
  return {
    [tickers[0]]: df * s,         // US domestic equity
    [tickers[1]]: (1 - df) * s,   // International equity
    [tickers[2]]: b,              // Bonds
  };
}

/**
 * Format implied per-fund target weights as a display string.
 * e.g. "64% VFINX · 16% VWIGX · 20% VBMFX"
 */
function formatWeights(stockPct, tickers, domesticFrac) {
  const df = domesticFrac !== undefined ? domesticFrac : EQUITY_DOMESTIC_FRAC;
  const s = stockPct / 100;
  return Math.round(df * s * 100) + '% ' + tickers[0] +
    ' \u00b7 ' + Math.round((1 - df) * s * 100) + '% ' + tickers[1] +
    ' \u00b7 ' + Math.round((1 - s) * 100) + '% ' + tickers[2];
}

/**
 * Matches simulator.py:_is_rebalance_month.
 * rebalance: 'annually' | 'quarterly' | 'never'
 */
function isRebalanceMonth(monthIdx, rebalance) {
  if (rebalance === 'never')     return false;
  if (rebalance === 'annually')  return monthIdx > 0 && monthIdx % 12 === 0;
  if (rebalance === 'quarterly') return monthIdx > 0 && monthIdx % 3  === 0;
  return false;
}

/**
 * Build a portfolio value series from per-asset monthly returns.
 * Lump sum $1, no contributions, no fees, no taxes.
 *
 * @param {string[]}                dates   - YYYY-MM-DD strings
 * @param {Object<string,number[]>} returns - { ticker: [monthly_ret, ...] }
 * @param {string[]}                tickers - ordered [us_eq, intl_eq, bond]
 * @param {{ weights: Object, rebalance: string }} config
 * @returns {{ dates, values, monthlyReturns }}
 */
function buildPortfolioSeries(dates, returns, tickers, config) {
  const { weights, rebalance } = config;
  const n = dates.length;
  const values = new Array(n), monthlyReturns = new Array(n);
  const h = {};
  for (const t of tickers) h[t] = weights[t];
  for (let i = 0; i < n; i++) {
    for (const t of tickers) h[t] *= (1 + returns[t][i]);
    let pv = 0; for (const t of tickers) pv += h[t];
    if (i === 0) {
      if (rebalance !== 'never') for (const t of tickers) h[t] = pv * weights[t];
    } else if (isRebalanceMonth(i, rebalance)) {
      for (const t of tickers) h[t] = pv * weights[t];
    }
    values[i] = pv;
    monthlyReturns[i] = i === 0 ? (pv - 1.0) : (pv / values[i - 1] - 1);
  }
  return { dates, values, monthlyReturns };
}

/**
 * Compute rolling windows from a portfolio series.
 *
 * @param {string[]} dates
 * @param {number[]} values
 * @param {number[]} monthlyReturns
 * @param {number}   windowMonths
 * @returns {Array<{ startDate, endDate, cagr, volAnnual, startIdx }>}
 *          cagr and volAnnual are in percent (e.g. 8.5 = 8.5%)
 */
function computeWindows(dates, values, monthlyReturns, windowMonths) {
  const windows = [], years = windowMonths / 12;
  const maxStart = dates.length - windowMonths;
  for (let i = 0; i <= maxStart; i++) {
    const startDate = dates[i], endDate = dates[i + windowMonths - 1];
    const vStart = i === 0 ? 1.0 : values[i - 1];
    const cagr = (Math.pow(values[i + windowMonths - 1] / vStart, 1 / years) - 1) * 100;
    const rets = monthlyReturns.slice(i, i + windowMonths);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
    const volAnnual = Math.sqrt(variance) * Math.sqrt(12) * 100;
    windows.push({ startDate, endDate, cagr, volAnnual, startIdx: i });
  }
  return windows;
}

/**
 * Compute fixed axis bounds from the shortest windows (widest spread).
 * Applies 10% padding. Returns bounds suitable for both vol/CAGR axes and
 * projection-wall extents (pVol*, pCagr*).
 *
 * @returns {{ volMin, volMax, cagrMin, cagrMax, zMin, zMax, pVolMin, pVolMax, pCagrMin, pCagrMax }}
 */
function computeFixedBounds(dates, values, monthlyReturns) {
  const minWindows = computeWindows(dates, values, monthlyReturns, MIN_WINDOW_MONTHS);
  const minVol  = minWindows.map(w => w.volAnnual);
  const minCagr = minWindows.map(w => w.cagr);
  const rawVolMin  = Math.min(...minVol),  rawVolMax  = Math.max(...minVol);
  const rawCagrMin = Math.min(...minCagr), rawCagrMax = Math.max(...minCagr);
  const vPad = (rawVolMax  - rawVolMin)  * 0.10;
  const cPad = (rawCagrMax - rawCagrMin) * 0.10;
  return {
    volMin:   rawVolMin  - vPad,
    volMax:   rawVolMax  + vPad,
    cagrMin:  rawCagrMin - cPad,
    cagrMax:  rawCagrMax + cPad,
    // z-axis anchored to end dates: earliest end = dates[MIN-1], latest = dates[n-1]
    zMin:     dates[MIN_WINDOW_MONTHS - 1],
    zMax:     dates[dates.length - 1],
    pVolMin:  rawVolMin  - vPad,
    pVolMax:  rawVolMax  + vPad,
    pCagrMin: rawCagrMin - cPad,
    pCagrMax: rawCagrMax + cPad,
  };
}

/**
 * Per-window quality score (combined vol+CAGR, range 0–1).
 * Uses fixedBounds for stable normalization across window lengths.
 */
function computeQualityArr(windows, fixedBounds) {
  const vRange = (fixedBounds.volMax  - fixedBounds.volMin)  || 1;
  const cRange = (fixedBounds.cagrMax - fixedBounds.cagrMin) || 1;
  return windows.map(w =>
    Math.max(0, Math.min(1,
      (1 - (w.volAnnual - fixedBounds.volMin) / vRange
         + (w.cagr      - fixedBounds.cagrMin) / cRange) / 2
    ))
  );
}

/** Per-window vol color array (0=red high-risk, 1=green low-risk). */
function computeVolColorArr(windows) {
  return windows.map(w =>
    Math.max(0, Math.min(1, 1 - (w.volAnnual - VOL_GREEN) / (VOL_RED - VOL_GREEN)))
  );
}

/** Per-window CAGR color array (0=red low-return, 1=green high-return). */
function computeCagrColorArr(windows) {
  return windows.map(w =>
    Math.max(0, Math.min(1, (w.cagr - CAGR_RED) / (CAGR_GREEN - CAGR_RED)))
  );
}


// ── Rebalancing delta functions ─────────────────────────────────────────────

/**
 * Generic per-window delta: Leg A minus Leg B.
 * Both legs can have different returns, tickers, weights, and rebalance policies.
 * Optional afterCagrFn(cagr, years) → adjustedCagr applied to each leg (for tax drag).
 *
 * @param {string[]} dates
 * @param {Object} returnsA, {string[]} tickersA, {Object} weightsA, {string} rebalanceA
 * @param {Object} returnsB, {string[]} tickersB, {Object} weightsB, {string} rebalanceB
 * @param {number} windowMonths
 * @param {Function|null} afterCagrFn
 * @returns {Array<{dGain, dVol}>}
 */
function computeAnyDeltaWindows(dates,
  returnsA, tickersA, weightsA, rebalanceA,
  returnsB, tickersB, weightsB, rebalanceB,
  windowMonths, afterCagrFn) {
  const years = windowMonths / 12;
  const maxStart = dates.length - windowMonths;
  const deltas = [];
  for (let i = 0; i <= maxStart; i++) {
    const winDates = dates.slice(i, i + windowMonths);
    const winA = {}, winB = {};
    for (const t of tickersA) winA[t] = returnsA[t].slice(i, i + windowMonths);
    for (const t of tickersB) winB[t] = returnsB[t].slice(i, i + windowMonths);
    const A = buildPortfolioSeries(winDates, winA, tickersA, { weights: weightsA, rebalance: rebalanceA });
    const B = buildPortfolioSeries(winDates, winB, tickersB, { weights: weightsB, rebalance: rebalanceB });
    let cagrA = (Math.pow(A.values[windowMonths - 1], 1 / years) - 1) * 100;
    let cagrB = (Math.pow(B.values[windowMonths - 1], 1 / years) - 1) * 100;
    if (afterCagrFn) { cagrA = afterCagrFn(cagrA, years); cagrB = afterCagrFn(cagrB, years); }
    const meanA = A.monthlyReturns.reduce((a, b) => a + b, 0) / A.monthlyReturns.length;
    const volA  = Math.sqrt(A.monthlyReturns.reduce((s, r) => s + (r - meanA) ** 2, 0) / (A.monthlyReturns.length - 1) * 12) * 100;
    const meanB = B.monthlyReturns.reduce((a, b) => a + b, 0) / B.monthlyReturns.length;
    const volB  = Math.sqrt(B.monthlyReturns.reduce((s, r) => s + (r - meanB) ** 2, 0) / (B.monthlyReturns.length - 1) * 12) * 100;
    deltas.push({ dGain: cagrA - cagrB, dVol: volA - volB });
  }
  return deltas;
}

/**
 * Compute per-window rebalancing delta (thin wrapper around computeAnyDeltaWindows).
 * Leg A = rebalanced, Leg B = buy-and-hold (same tickers/weights/returns).
 * Returns null if rebalance === 'never' (delta is identically zero).
 *
 * @param {string[]}                dates        - full date array (YYYY-MM-DD)
 * @param {Object<string,number[]>} returns      - { ticker: [monthly_ret, ...] }
 * @param {string[]}                tickers      - [us_eq, intl_eq, bond]
 * @param {Object}                  weights      - target weights from computeWeights()
 * @param {string}                  rebalance    - 'annually'|'quarterly'|'never'
 * @param {number}                  windowMonths
 * @returns {Array<{dGain, dVol}>|null}
 */
function computeDeltaWindows(dates, returns, tickers, weights, rebalance, windowMonths) {
  if (rebalance === 'never') return null;
  return computeAnyDeltaWindows(dates,
    returns, tickers, weights, rebalance,
    returns, tickers, weights, 'never',
    windowMonths, null);
}

/**
 * Compute fixed delta-axis bounds from delta windows at a given length.
 * Applies 10% padding. Always includes zero in both Δvol and Δgain ranges.
 * Returns null if rebalance === 'never'.
 *
 * windowMonths: the window length to use for bounds computation.
 *   Must be long enough to contain at least one non-trivial rebalancing event:
 *   - annually: first event fires at month 12, so need windowMonths > 12
 *   - quarterly: first event fires at month 3, so need windowMonths > 3
 *   Caller should pass the current display window length.
 *
 * @returns {{ dVolMin, dVolMax, dGainMin, dGainMax, zMin, zMax }} or null
 */
function computeFixedDeltaBounds(dates, returns, tickers, weights, rebalance, windowMonths) {
  // Ensure window contains at least one non-trivial rebalancing event.
  // For annually: event fires at index 12, so need > 12 months.
  // For quarterly: event fires at index 3, so need > 3 months.
  const rebalPeriod = rebalance === 'quarterly' ? 3 : 12;
  const w = Math.max(windowMonths !== undefined ? windowMonths : MIN_WINDOW_MONTHS, rebalPeriod + 1);
  const minDeltas = computeDeltaWindows(dates, returns, tickers, weights, rebalance, w);
  if (!minDeltas) return null;
  const dVols  = minDeltas.map(d => d.dVol);
  const dGains = minDeltas.map(d => d.dGain);
  const rawV0 = Math.min(...dVols),  rawV1 = Math.max(...dVols);
  const rawG0 = Math.min(...dGains), rawG1 = Math.max(...dGains);
  const vPad = (rawV1 - rawV0) * 0.10;
  const gPad = (rawG1 - rawG0) * 0.10;
  return {
    dVolMin:  Math.min(rawV0 - vPad, -1),
    dVolMax:  Math.max(rawV1 + vPad,  1),
    dGainMin: Math.min(rawG0 - gPad, -1),
    dGainMax: Math.max(rawG1 + gPad,  1),
    zMin: dates[w - 1],
    zMax: dates[dates.length - 1],
  };
}


/**
 * Compute fixed delta-axis bounds for a generic two-leg delta.
 * Uses the current windowMonths (clamped to >=13 to ensure non-trivial data).
 * Always includes zero in both axes. Padding = 10%.
 *
 * @returns {{ dVolMin, dVolMax, dGainMin, dGainMax, zMin, zMax }} or null
 */
function computeFixedAnyDeltaBounds(dates,
  returnsA, tickersA, weightsA, rebalanceA,
  returnsB, tickersB, weightsB, rebalanceB,
  windowMonths, afterCagrFn) {
  const w = Math.max(windowMonths !== undefined ? windowMonths : MIN_WINDOW_MONTHS, 13);
  if (dates.length < w) return null;
  const minDeltas = computeAnyDeltaWindows(dates,
    returnsA, tickersA, weightsA, rebalanceA,
    returnsB, tickersB, weightsB, rebalanceB,
    w, afterCagrFn);
  const dVols  = minDeltas.map(d => d.dVol);
  const dGains = minDeltas.map(d => d.dGain);
  const rawV0 = Math.min(...dVols),  rawV1 = Math.max(...dVols);
  const rawG0 = Math.min(...dGains), rawG1 = Math.max(...dGains);
  const vPad = (rawV1 - rawV0) * 0.10;
  const gPad = (rawG1 - rawG0) * 0.10;
  return {
    dVolMin:  Math.min(rawV0 - vPad, -0.5),
    dVolMax:  Math.max(rawV1 + vPad,  0.5),
    dGainMin: Math.min(rawG0 - gPad, -0.5),
    dGainMax: Math.max(rawG1 + gPad,  0.5),
    zMin: dates[w - 1],
    zMax: dates[dates.length - 1],
  };
}


// ── Shared helpers ─────────────────────────────────────────────────────────

/** "YYYY-MM-DD" → "YYYY-MM" */
function ym(dateStr) { return dateStr.slice(0, 7); }

/** 60 → "5yr", 18 → "1yr 6mo", 6 → "6mo" */
function formatWindowLength(months) {
  const yr = Math.floor(months / 12), mo = months % 12;
  if (mo === 0) return yr + 'yr';
  if (yr === 0) return mo + 'mo';
  return yr + 'yr ' + mo + 'mo';
}

/** Simple debounce. */
function debounce(fn, ms) {
  var timer = null;
  return function() {
    var args = arguments, ctx = this;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, ms);
  };
}


// ── Fee / tax helpers ───────────────────────────────────────────────────────

/**
 * Add back annual ERs to monthly returns to get pre-cost "gross" returns.
 * Returns a NEW returns object; does not mutate input.
 * annualERs: array of annual ER % values, parallel to tickers.
 */
function addBackMonthlyFee(returns, tickers, annualERs) {
  const out = {};
  for (let i = 0; i < tickers.length; i++) {
    const drag = annualERs[i] / 100 / 12;
    out[tickers[i]] = returns[tickers[i]].map(r => r + drag);
  }
  return out;
}

/**
 * Apply end-of-window LTCG on gains (lump-sum entry, lump-sum exit).
 * Matches simulator.py "end" tax mode for lump-sum rolling windows.
 * cagr: in percent (e.g. 8.5); years: window length; returns adjusted cagr %.
 */
function applyEndTax(cagr, years) {
  const finalValue = Math.pow(1 + cagr / 100, years);
  const gain = finalValue - 1.0;
  const tax  = gain > 0 ? gain * LTCG_RATE : 0;
  return (Math.pow(finalValue - tax, 1 / years) - 1) * 100;
}
