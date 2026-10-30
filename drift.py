"""
Allocation drift and volatility metrics for the Rebalancing Impact page.

Everything here is derived from one backtest run's holdings history
(simulator.simulate(..., record_history=True)); no extra price data is needed.
Realized rolling volatility is computed client-side from `monthly_returns`.
"""
import math
from typing import Optional

import numpy as np
import pandas as pd


def _weights(holdings: dict, funds: list) -> list:
    total = sum(holdings[f] for f in funds)
    if total <= 0:
        return [0.0 for _ in funds]
    return [holdings[f] / total for f in funds]


def covariance_matrix(fund_returns: pd.DataFrame, funds: list) -> np.ndarray:
    """Sample covariance (monthly) of fund returns over the whole selected range."""
    df = fund_returns[funds].astype(float)
    if len(df) < 2:
        return np.zeros((len(funds), len(funds)))
    return np.atleast_2d(np.cov(df.values, rowvar=False, ddof=1))


def time_weighted_returns(holdings_history: list) -> list:
    """
    Cross-check for compute_drift_metrics' monthly returns, from portfolio values only.

    Contributions arrive at the end of the month (after the market move), so
    r(t) = (V(t) - C(t)) / V(t-1) - 1, where V(t-1) is the value entering month t.
    Fees and rebalance taxes reduce V(t), so they are included in this return.
    """
    out = []
    for rec in holdings_history:
        v_start = sum(rec["start"].values())
        v_end = sum(rec["end"].values())
        out.append((v_end - rec["contribution"]) / v_start - 1.0 if v_start > 0 else 0.0)
    return out


def compute_drift_metrics(
    holdings_history: list,
    fund_returns: pd.DataFrame,
    rebalance_dates,
    equity_funds,
    cov_matrix: Optional[np.ndarray] = None,
    decimals: Optional[int] = None,
) -> dict:
    """
    Build the drift series for one strategy run.

    holdings_history: records from simulate(record_history=True), one per month.
    fund_returns:     monthly returns per fund for the simulated months (index = month-ends).
    rebalance_dates:  dates (YYYY-MM-DD) on which the run rebalanced to target.
    equity_funds:     funds counted toward equity %.
    cov_matrix:       monthly covariance of the funds (in fund order); estimated from
                      fund_returns when omitted. Pass the same matrix for every strategy
                      so implied vol moves only when weights move.

    Returns the per-strategy `drift` object described in the API:
      weight_dates, weights {fund: []}, equity_pct, implied_vol, return_dates, monthly_returns
    """
    if not holdings_history:
        return {"weight_dates": [], "weights": {}, "equity_pct": [], "implied_vol": [],
                "return_dates": [], "monthly_returns": []}

    funds = list(holdings_history[0]["end"].keys())
    equity = set(equity_funds)
    rebal = set(str(d) for d in rebalance_dates)
    sigma = covariance_matrix(fund_returns, funds) if cov_matrix is None else np.asarray(cov_matrix)

    weight_dates, weight_rows = [], []
    return_dates, monthly_returns = [], []

    returns_by_date = {str(idx.date()) if hasattr(idx, "date") else str(idx): row
                       for idx, row in fund_returns[funds].iterrows()}

    for rec in holdings_history:
        date = rec["date"]

        # 1. Weights: after the market move, before any rebalance. On rebalance
        #    dates add the post-rebalance weights at the same date (the reset).
        weight_dates.append(date)
        weight_rows.append(_weights(rec["pre"], funds))
        if date in rebal:
            weight_dates.append(date)
            weight_rows.append(_weights(rec["end"], funds))

        # 2. Contribution-neutral return: fund returns weighted by the weights
        #    held entering the month (post-rebalance if the prior month rebalanced).
        #    Rebalancing swaps assets inside the portfolio, so it needs no adjustment.
        #    Fees and rebalance taxes are deducted from the portfolio, so they are
        #    part of performance and are subtracted here; that keeps this equal to
        #    time_weighted_returns() with or without fees.
        w_start = _weights(rec["start"], funds)
        r_i = returns_by_date[date]
        gross = sum(w * float(r_i[f]) for w, f in zip(w_start, funds))
        v_start = sum(rec["start"].values())
        deductions = rec.get("fee", 0.0) + rec.get("tax", 0.0)
        net = gross - (deductions / v_start if v_start > 0 else 0.0)
        return_dates.append(date)
        monthly_returns.append(net)

    W = np.array(weight_rows)
    eq_idx = [i for i, f in enumerate(funds) if f in equity]
    equity_pct = W[:, eq_idx].sum(axis=1) if eq_idx else np.zeros(len(W))

    # 3. Implied vol: annualized vol of each entry's weights under one fixed Σ.
    quad = np.einsum("ij,jk,ik->i", W, sigma, W)
    implied = np.sqrt(12.0) * np.sqrt(np.clip(quad, 0.0, None))

    def rnd(seq):
        if decimals is None:
            return [float(x) for x in seq]
        return [round(float(x), decimals) for x in seq]

    return {
        "weight_dates": weight_dates,
        "weights": {f: rnd(W[:, i]) for i, f in enumerate(funds)},
        "equity_pct": rnd(equity_pct),
        "implied_vol": rnd(implied),
        "return_dates": return_dates,
        "monthly_returns": rnd(monthly_returns) if decimals is None
                           else [round(float(x), decimals + 2) for x in monthly_returns],
    }


def cov_to_list(sigma: np.ndarray, decimals: int = 8) -> list:
    return [[round(float(x), decimals) for x in row] for row in np.atleast_2d(sigma)]


def realized_vol(monthly_returns: list, window: int) -> list:
    """Reference implementation of the client-side rolling vol (used in tests)."""
    out = []
    for t in range(len(monthly_returns)):
        if t + 1 < window:
            out.append(None)
            continue
        seg = monthly_returns[t - window + 1: t + 1]
        out.append(math.sqrt(12.0) * float(np.std(seg, ddof=1)))
    return out
