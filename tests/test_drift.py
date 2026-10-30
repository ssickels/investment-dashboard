"""
Unit tests for drift.compute_drift_metrics (Rebalancing Impact drift & volatility panel).

Run: python3 -m pytest tests/
Uses synthetic monthly returns, so no network or price cache is needed.
"""
import os
import sys

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from drift import compute_drift_metrics, covariance_matrix, realized_vol, time_weighted_returns  # noqa: E402
from simulator import SimParams, compute_weights, simulate  # noqa: E402

FUNDS = ["VTI", "VXUS", "BND"]
EQUITY = ["VTI", "VXUS"]
MODES = ["never", "quarterly", "annually"]


def make_returns(months=180, seed=7):
    """Stocks trend up faster than bonds, so an unrebalanced 80/20 drifts toward stocks."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2011-01-31", periods=months, freq="ME")
    return pd.DataFrame({
        "VTI":  rng.normal(0.010, 0.045, months),
        "VXUS": rng.normal(0.006, 0.050, months),
        "BND":  rng.normal(0.002, 0.012, months),
    }, index=idx)


def run(returns, mode, stock_pct=80.0, initial=10_000.0, contrib=500.0,
        fee=0.0, tax_mode="none"):
    params = SimParams(initial_amount=initial, monthly_contrib=contrib, stock_pct=stock_pct,
                       rebalance=mode, months_override=len(returns))
    weights = compute_weights(stock_pct, FUNDS)
    sim = simulate(returns, FUNDS, weights, params, monthly_fee_rate=fee,
                   tax_mode=tax_mode, record_history=True)
    hist = sim["holdings_history"]
    rebal_dates = [r["date"] for r in hist if r["rebalanced"]]
    drift = compute_drift_metrics(hist, returns, rebal_dates, EQUITY,
                                  cov_matrix=covariance_matrix(returns, FUNDS))
    return sim, hist, rebal_dates, drift, weights


# Runs with fees and rebalance-time taxes too, so the bookkeeping is exercised everywhere.
VARIANTS = [
    dict(),
    dict(fee=(1.01 ** (1 / 12)) - 1, tax_mode="rebalance"),
    dict(contrib=0.0),
]


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("variant", VARIANTS)
def test_weights_sum_to_one(mode, variant):
    _, _, _, drift, _ = run(make_returns(), mode, **variant)
    totals = np.sum([drift["weights"][f] for f in FUNDS], axis=0)
    assert len(totals) == len(drift["weight_dates"])
    np.testing.assert_allclose(totals, 1.0, atol=1e-12)


@pytest.mark.parametrize("mode", ["quarterly", "annually"])
@pytest.mark.parametrize("variant", VARIANTS)
def test_post_rebalance_weights_equal_target(mode, variant):
    _, _, rebal_dates, drift, target = run(make_returns(), mode, **variant)
    assert rebal_dates, "expected rebalance dates"
    dates = drift["weight_dates"]
    for d in rebal_dates:
        # A rebalance date appears twice: pre, then post
        positions = [i for i, x in enumerate(dates) if x == d]
        assert len(positions) == 2
        post = positions[1]
        for f in FUNDS:
            assert abs(drift["weights"][f][post] - target[f]) < 1e-9


def test_never_has_no_duplicate_dates_and_drifts_up():
    _, hist, rebal_dates, drift, _ = run(make_returns(), "never")
    assert rebal_dates == []
    assert drift["weight_dates"] == [r["date"] for r in hist]
    assert drift["equity_pct"][-1] > 0.85


def test_all_bond_split_is_constant_and_implied_vol_identical():
    returns = make_returns()
    drifts = [run(returns, m, stock_pct=0.0)[3] for m in MODES]
    for d in drifts:
        np.testing.assert_allclose(d["equity_pct"], 0.0, atol=1e-12)
    # Same weights every month -> same implied vol at every entry, for every strategy
    ref = drifts[0]["implied_vol"][0]
    for d in drifts:
        np.testing.assert_allclose(d["implied_vol"], ref, rtol=0, atol=1e-12)


def test_all_stock_split_equity_pct_constant():
    # Implied vol is NOT identical at 100/0: equity is split 80/20 between VTI and VXUS,
    # and that intra-equity mix still drifts without rebalancing.
    returns = make_returns()
    for m in MODES:
        d = run(returns, m, stock_pct=100.0)[3]
        np.testing.assert_allclose(d["equity_pct"], 1.0, atol=1e-12)


@pytest.mark.parametrize("mode", MODES)
def test_weighted_return_matches_twr_without_contributions(mode):
    _, hist, _, drift, _ = run(make_returns(), mode, contrib=0.0)
    np.testing.assert_allclose(drift["monthly_returns"], time_weighted_returns(hist),
                               rtol=0, atol=1e-9)


@pytest.mark.parametrize("mode", MODES)
def test_weighted_return_matches_twr_with_fees_and_taxes(mode):
    # Fees and rebalance taxes are part of performance, so they are in both methods.
    _, hist, _, drift, _ = run(make_returns(), mode, fee=0.001, tax_mode="rebalance")
    np.testing.assert_allclose(drift["monthly_returns"], time_weighted_returns(hist),
                               rtol=0, atol=1e-9)


@pytest.mark.parametrize("mode", MODES)
def test_contributions_do_not_create_return_jumps(mode):
    # $500/month on a $1,000 start: naive value change would be ~+50% in month 1.
    returns = make_returns()
    sim, hist, _, drift, _ = run(returns, mode, initial=1_000.0, contrib=500.0)
    r = np.array(drift["monthly_returns"])
    lo = returns[FUNDS].min(axis=1).values
    hi = returns[FUNDS].max(axis=1).values
    # A portfolio return is a weighted average of its funds' returns
    assert np.all(r >= lo - 1e-12) and np.all(r <= hi + 1e-12)
    naive = np.array(sim["values"][1:6]) / np.array(sim["values"][0:5]) - 1
    assert naive.max() > 0.2          # the jump exists in raw values ...
    assert np.abs(r[:6]).max() < 0.2  # ... but not in contribution-neutral returns
    np.testing.assert_allclose(r, time_weighted_returns(hist), rtol=0, atol=1e-9)


@pytest.mark.parametrize("mode", ["quarterly", "annually"])
def test_rebalancing_does_not_change_value(mode):
    _, hist, _, _, _ = run(make_returns(), mode)
    rebalanced = [r for r in hist if r["rebalanced"]]
    assert rebalanced
    for rec in rebalanced:
        before = sum(rec["pre"].values()) + rec["contribution"]
        after = sum(rec["end"].values())
        assert abs(after - before) < 1e-6


def test_realized_vol_window_leading_nulls():
    _, _, _, drift, _ = run(make_returns(), "never")
    rv = realized_vol(drift["monthly_returns"], 36)
    assert all(v is None for v in rv[:35])
    assert all(v is not None and v > 0 for v in rv[35:])
