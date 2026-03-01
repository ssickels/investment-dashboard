"""
Portfolio simulation logic.
Uses per-holding tracking (not aggregate weights) to properly model rebalancing drift.
"""
from dataclasses import dataclass
from typing import Optional
import pandas as pd


@dataclass
class SimParams:
    initial_amount: float = 10000.0
    monthly_contrib: float = 500.0
    years: int = 10
    stock_pct: float = 80.0          # 0-100
    rebalance: str = "annually"      # never | annually | quarterly
    aum_fee_pct: float = 1.0         # % per year, applied to Scenarios 2 & 4
    inflation_adj: bool = False


def compute_weights(stock_pct: float, tickers: list) -> dict:
    """
    tickers = [equity_us, equity_intl, bond]
    equity_us = 80% of equity, equity_intl = 20% of equity, bond = remainder.
    Returns weights summing to 1.0.
    """
    s = stock_pct / 100.0
    b = 1.0 - s
    return {
        tickers[0]: 0.8 * s,
        tickers[1]: 0.2 * s,
        tickers[2]: b,
    }


def _is_rebalance_month(month_idx: int, rebalance: str) -> bool:
    if rebalance == "never":
        return False
    if rebalance == "annually":
        return month_idx > 0 and month_idx % 12 == 0
    if rebalance == "quarterly":
        return month_idx > 0 and month_idx % 3 == 0
    return False


def simulate(
    returns_df: pd.DataFrame,
    tickers: list,
    weights: dict,
    params: SimParams,
    monthly_fee_rate: float = 0.0,
    deflator: Optional[pd.Series] = None,
) -> dict:
    """
    Simulate a portfolio for the given tickers/weights/params.

    Returns dict with:
      - values: list of portfolio values (one per month)
      - dates: list of date strings
      - stats: {final_value, total_contributions, total_gain, cagr, total_fees_paid}
    """
    # Slice to requested years
    months = params.years * 12
    slice_df = returns_df[tickers].iloc[:months]

    if len(slice_df) == 0:
        raise ValueError("No data available for simulation")

    # Initialize holdings
    holdings = {t: params.initial_amount * weights[t] for t in tickers}
    total_fees_paid = 0.0
    values = []
    dates = []

    for i, (date, row) in enumerate(slice_df.iterrows()):
        # Apply monthly returns
        for t in tickers:
            holdings[t] *= (1.0 + float(row[t]))

        portfolio_value = sum(holdings.values())

        # Apply AUM fee (before contribution)
        if monthly_fee_rate > 0:
            fee = portfolio_value * monthly_fee_rate
            total_fees_paid += fee
            # Reduce holdings proportionally
            ratio = (portfolio_value - fee) / portfolio_value
            for t in tickers:
                holdings[t] *= ratio
            portfolio_value -= fee

        # Add monthly contribution
        if i > 0:  # skip first month (initial invested at start)
            if _is_rebalance_month(i, params.rebalance):
                # Add contribution then rebalance everything
                portfolio_value += params.monthly_contrib
                holdings = {t: portfolio_value * weights[t] for t in tickers}
            else:
                # Add contribution proportional to current drifted weights
                cur_total = sum(holdings.values())
                if cur_total > 0:
                    for t in tickers:
                        holdings[t] += params.monthly_contrib * (holdings[t] / cur_total)
                portfolio_value += params.monthly_contrib
        else:
            # First month: rebalance if requested (sets target weights from start)
            if params.rebalance != "never":
                holdings = {t: portfolio_value * weights[t] for t in tickers}

        portfolio_value = sum(holdings.values())
        values.append(portfolio_value)
        dates.append(str(date.date()))

    # Apply CPI deflation if requested
    if deflator is not None and params.inflation_adj:
        deflator_aligned = deflator.reindex(slice_df.index, method="ffill")
        for i, date in enumerate(slice_df.index):
            if date in deflator_aligned.index and not pd.isna(deflator_aligned[date]):
                values[i] *= float(deflator_aligned[date])

    n = len(values)
    total_contributions = params.initial_amount + params.monthly_contrib * max(0, n - 1)
    final_value = values[-1] if values else 0.0
    total_gain = final_value - total_contributions

    # CAGR based on months simulated
    if n > 0 and total_contributions > 0 and final_value > 0:
        cagr = (final_value / total_contributions) ** (12.0 / n) - 1.0
    else:
        cagr = 0.0

    return {
        "values": [round(v, 2) for v in values],
        "dates": dates,
        "stats": {
            "final_value": round(final_value, 2),
            "total_contributions": round(total_contributions, 2),
            "total_gain": round(total_gain, 2),
            "cagr": round(cagr * 100, 4),  # as percent
            "total_fees_paid": round(total_fees_paid, 2),
        },
    }


def simulate_momentum(
    returns_df: pd.DataFrame,
    equity_tickers: list,
    bond_tickers: list,
    params: SimParams,
    monthly_fee_rate: float = 0.0,
    deflator: Optional[pd.Series] = None,
    yield_curve_spread: Optional[pd.Series] = None,
    aggressiveness: str = "moderate",
) -> dict:
    """
    Full advisor momentum simulation supporting a variable-size universe.

    Weighting: rank-based N-point system — best fund gets N points, next N-1, ..., worst 1.
    Inception handling: at each annual rebalance, only funds with full 12-month trailing
    history are eligible (no look-ahead).
    Tactical overlay: if the yield curve (T10Y2Y) was negative at any point during the
    prior 12 months, reduce equity by the aggressiveness-determined shift and redirect
    all bond allocation to the best-performing bond fund.
    Bond allocation always goes to the best-performing bond fund.

    aggressiveness modifies equity concentration:
      conservative → N-point weights + 5%-of-equity-allocation floor per fund
      moderate     → standard N-point weights
      aggressive   → double the top-3 funds' points before normalising
    """
    all_tickers = equity_tickers + bond_tickers
    avail_cols = [t for t in all_tickers if t in returns_df.columns]
    if not avail_cols:
        raise ValueError("None of the universe tickers found in returns data")

    months = params.years * 12
    slice_df = returns_df[avail_cols].iloc[:months]
    if len(slice_df) == 0:
        raise ValueError("No data available for momentum simulation")

    s = params.stock_pct / 100.0
    b = 1.0 - s

    TACTICAL_SHIFTS = {"conservative": 0.10, "moderate": 0.20, "aggressive": 0.35}
    tactical_shift = TACTICAL_SHIFTS.get(aggressiveness, 0.20)

    # Pre-align yield curve to simulation dates
    yc_aligned = None
    if yield_curve_spread is not None:
        yc_aligned = yield_curve_spread.reindex(slice_df.index, method="ffill")

    # --- Cold start: equal-weight available funds ---
    first_row = slice_df.iloc[0]
    avail_eq_0 = [t for t in equity_tickers if t in avail_cols and not pd.isna(first_row[t])]
    avail_bond_0 = [t for t in bond_tickers if t in avail_cols and not pd.isna(first_row[t])]
    if not avail_eq_0:
        avail_eq_0 = [t for t in equity_tickers if t in avail_cols][:2]
    if not avail_bond_0:
        avail_bond_0 = [t for t in bond_tickers if t in avail_cols][:1]

    holdings = {t: 0.0 for t in avail_cols}
    for t in avail_eq_0:
        holdings[t] = params.initial_amount * s / len(avail_eq_0)
    for t in avail_bond_0:
        holdings[t] += params.initial_amount * b / len(avail_bond_0)

    total_fees_paid = 0.0
    values = []
    dates = []

    for i, (date, row) in enumerate(slice_df.iterrows()):
        # Apply monthly returns (NaN → 0 for pre-inception positions, which have 0 holdings)
        for t in avail_cols:
            ret = float(row[t]) if not pd.isna(row[t]) else 0.0
            holdings[t] *= (1.0 + ret)

        portfolio_value = sum(holdings.values())

        # Apply AUM fee before contribution
        if monthly_fee_rate > 0 and portfolio_value > 0:
            fee = portfolio_value * monthly_fee_rate
            total_fees_paid += fee
            ratio = (portfolio_value - fee) / portfolio_value
            for t in avail_cols:
                holdings[t] *= ratio
            portfolio_value -= fee

        # Annual momentum rebalance
        if i > 0 and i % 12 == 0:
            lookback = slice_df.iloc[i - 12:i]

            # Eligible funds: full 12 months of non-NaN returns (no look-ahead)
            avail_eq = [t for t in equity_tickers
                        if t in lookback.columns and lookback[t].notna().all()]
            avail_bond = [t for t in bond_tickers
                          if t in lookback.columns and lookback[t].notna().all()]
            if not avail_eq:
                avail_eq = avail_eq_0
            if not avail_bond:
                avail_bond = avail_bond_0

            cum_ret = (1 + lookback[avail_eq + avail_bond]).prod() - 1

            # --- Tactical overlay: was curve inverted during prior 12 months? ---
            effective_s, effective_b = s, b
            if yc_aligned is not None:
                yc_window = yc_aligned.iloc[i - 12:i].dropna()
                if len(yc_window) > 0 and (yc_window < 0).any():
                    shift = min(tactical_shift, effective_s)
                    effective_s -= shift
                    effective_b += shift

            # Best-performing bond fund receives all bond allocation
            best_bond = cum_ret[avail_bond].idxmax()

            # --- N-point momentum ranking for equity ---
            sorted_eq = cum_ret[avail_eq].sort_values()  # ascending: worst first
            n_eq = len(sorted_eq)
            rank_pts = {t: (rank + 1) for rank, t in enumerate(sorted_eq.index)}

            # Aggressive: double points of top 3
            if aggressiveness == "aggressive" and n_eq >= 3:
                for t in list(sorted_eq.index[-3:]):
                    rank_pts[t] *= 2

            total_pts = sum(rank_pts.values())
            new_weights = {t: 0.0 for t in avail_cols}
            for t, pts in rank_pts.items():
                new_weights[t] = effective_s * pts / total_pts

            # Conservative: 5%-of-equity-allocation floor per fund, then renormalise
            if aggressiveness == "conservative":
                floor_w = 0.05 * effective_s
                for t in rank_pts:
                    new_weights[t] = max(new_weights[t], floor_w)
                eq_sum = sum(new_weights[t] for t in rank_pts)
                if eq_sum > 0:
                    for t in rank_pts:
                        new_weights[t] = new_weights[t] / eq_sum * effective_s

            new_weights[best_bond] = effective_b

            # Rebalance + add contribution
            portfolio_value += params.monthly_contrib
            holdings = {t: 0.0 for t in avail_cols}
            for t, w in new_weights.items():
                if w > 0:
                    holdings[t] = portfolio_value * w

        elif i > 0:
            cur_total = sum(holdings.values())
            if cur_total > 0:
                for t in avail_cols:
                    holdings[t] += params.monthly_contrib * (holdings[t] / cur_total)

        values.append(sum(holdings.values()))
        dates.append(str(date.date()))

    # CPI deflation
    if deflator is not None and params.inflation_adj:
        deflator_aligned = deflator.reindex(slice_df.index, method="ffill")
        for i, date in enumerate(slice_df.index):
            if date in deflator_aligned.index and not pd.isna(deflator_aligned[date]):
                values[i] *= float(deflator_aligned[date])

    n_m = len(values)
    total_contributions = params.initial_amount + params.monthly_contrib * max(0, n_m - 1)
    final_value = values[-1] if values else 0.0
    total_gain = final_value - total_contributions
    cagr = (
        (final_value / total_contributions) ** (12.0 / n_m) - 1.0
        if n_m > 0 and total_contributions > 0 and final_value > 0
        else 0.0
    )

    return {
        "values": [round(v, 2) for v in values],
        "dates": dates,
        "stats": {
            "final_value": round(final_value, 2),
            "total_contributions": round(total_contributions, 2),
            "total_gain": round(total_gain, 2),
            "cagr": round(cagr * 100, 4),
            "total_fees_paid": round(total_fees_paid, 2),
        },
    }


def run_all_scenarios(
    returns_df: pd.DataFrame,
    deflator: Optional[pd.Series],
    params: SimParams,
    diy_tickers: list = None,
    active_tickers: list = None,
    monthly_managed_fee_rate: float = 0.0,
    monthly_active_managed_fee_rate: float = 0.0,
    # Momentum params
    diy_equity_tickers: list = None,
    diy_bond_tickers: list = None,
    active_equity_tickers: list = None,
    active_bond_tickers: list = None,
    expanded_returns_df: Optional[pd.DataFrame] = None,
    monthly_momentum_fee_rate: float = 0.0,
    yield_curve_spread: Optional[pd.Series] = None,
    aggressiveness: str = "moderate",
) -> dict:
    """
    Run all 4 investment scenarios.

    Scenario 1 (DIY): diy_tickers, no extra fees
    Scenario 2 (Fee-Adjusted Managed): same weights, AUM + active fund expense ratio
    Scenario 3 (Actively Managed): active tickers, expense ratio already in returns
    Scenario 4 (Fee-Adjusted Active): active tickers, AUM fee only (ER already in returns)
    """
    if diy_tickers is None:
        diy_tickers = ["VTI", "VXUS", "BND"]
    weights = compute_weights(params.stock_pct, diy_tickers)

    # Active fund weights: same stock/bond ratio but different tickers
    if active_tickers is None:
        active_tickers = ["AGTHX", "DODFX", "PTTAX"]
    s = params.stock_pct / 100.0
    b = 1.0 - s
    active_weights = {
        active_tickers[0]: 0.8 * s,
        active_tickers[1]: 0.2 * s,
        active_tickers[2]: b,
    }

    diy = simulate(
        returns_df=returns_df,
        tickers=diy_tickers,
        weights=weights,
        params=params,
        monthly_fee_rate=0.0,
        deflator=deflator,
    )

    managed = simulate(
        returns_df=returns_df,
        tickers=diy_tickers,
        weights=weights,
        params=params,
        monthly_fee_rate=monthly_managed_fee_rate,
        deflator=deflator,
    )

    active = simulate(
        returns_df=returns_df,
        tickers=active_tickers,
        weights=active_weights,
        params=params,
        monthly_fee_rate=0.0,
        deflator=deflator,
    )

    active_managed = simulate(
        returns_df=returns_df,
        tickers=active_tickers,
        weights=active_weights,
        params=params,
        monthly_fee_rate=monthly_active_managed_fee_rate,
        deflator=deflator,
    )

    diy_str    = " / ".join(diy_tickers)
    ticker_str = " / ".join(active_tickers)
    result = {
        "diy": {**diy, "label": f"Low-Cost Index ({diy_str})"},
        "managed": {**managed, "label": f"Fee-Adjusted Index ({diy_str})"},
        "active": {**active, "label": f"Actively Managed ({ticker_str})"},
        "active_managed": {**active_managed, "label": f"Fee-Adjusted Active ({ticker_str})"},
    }

    # DIY momentum: uses main returns_df (3-fund universe, always available)
    if diy_equity_tickers and diy_bond_tickers:
        try:
            mom_str = " / ".join(diy_equity_tickers + diy_bond_tickers)
            result["diy_momentum"] = {
                **simulate_momentum(
                    returns_df=returns_df,
                    equity_tickers=diy_equity_tickers,
                    bond_tickers=diy_bond_tickers,
                    params=params,
                    monthly_fee_rate=monthly_momentum_fee_rate,
                    deflator=deflator,
                    yield_curve_spread=yield_curve_spread,
                    aggressiveness=aggressiveness,
                ),
                "label": f"Index Momentum ({mom_str})",
            }
        except Exception as e:
            print(f"Warning: DIY momentum failed: {e}")

    # Active momentum: uses expanded outer-join df with full advisor universe
    if active_equity_tickers and active_bond_tickers and expanded_returns_df is not None:
        try:
            n_eq = len(active_equity_tickers)
            n_b = len(active_bond_tickers)
            result["active_momentum"] = {
                **simulate_momentum(
                    returns_df=expanded_returns_df,
                    equity_tickers=active_equity_tickers,
                    bond_tickers=active_bond_tickers,
                    params=params,
                    monthly_fee_rate=monthly_momentum_fee_rate,
                    deflator=deflator,
                    yield_curve_spread=yield_curve_spread,
                    aggressiveness=aggressiveness,
                ),
                "label": f"Active Momentum ({n_eq} equity + {n_b} bond funds)",
            }
        except Exception as e:
            print(f"Warning: Active momentum failed: {e}")

    return result
