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
    tickers: list,
    params: SimParams,
    monthly_fee_rate: float = 0.0,
    deflator: Optional[pd.Series] = None,
    yield_curve_spread: Optional[pd.Series] = None,
    aggressiveness: str = "moderate",
) -> dict:
    """
    Simulate an annual momentum-rotation portfolio over the given 3-ticker universe.

    tickers = [equity_us, equity_intl, bond]
    Bond is held at the target weight; the two equity funds are ranked annually by
    trailing 12-month return.  No look-ahead: at month i, only returns[i-12..i-1] used.

    aggressiveness controls two behaviours at each annual rebalance:
      - Momentum concentration:
          conservative  → bottom 40% / top 60% of equity (+ 5% portfolio floor)
          moderate      → bottom 1/3 / top 2/3  (current default)
          aggressive    → bottom 25% / top 75%
      - Tactical yield-curve shift (when spread < 0 at rebalance date):
          conservative  → move 10% of equity allocation to bonds
          moderate      → move 20%
          aggressive    → move 35%
    """
    months = params.years * 12
    slice_df = returns_df[tickers].iloc[:months]

    if len(slice_df) == 0:
        raise ValueError("No data available for momentum simulation")

    s = params.stock_pct / 100.0
    b = 1.0 - s

    # Equity concentration: (bottom_fraction, top_fraction) of equity allocation
    EQ_SPLITS = {
        "conservative": (2 / 5, 3 / 5),
        "moderate":     (1 / 3, 2 / 3),
        "aggressive":   (1 / 4, 3 / 4),
    }
    # Tactical shift: fraction of equity moved to bonds during inversion
    TACTICAL_SHIFTS = {
        "conservative": 0.10,
        "moderate":     0.20,
        "aggressive":   0.35,
    }
    CONSERVATIVE_FLOOR = 0.05   # min 5% of total portfolio per equity fund (conservative)
    bot_frac, top_frac = EQ_SPLITS.get(aggressiveness, EQ_SPLITS["moderate"])
    tactical_shift = TACTICAL_SHIFTS.get(aggressiveness, 0.20)

    # Pre-align yield curve to simulation dates
    yc_aligned = None
    if yield_curve_spread is not None:
        yc_aligned = yield_curve_spread.reindex(slice_df.index, method="ffill")

    # Cold start: standard 80/20 equity split, bond at target
    current_weights = {tickers[0]: 0.8 * s, tickers[1]: 0.2 * s, tickers[2]: b}
    holdings = {t: params.initial_amount * current_weights[t] for t in tickers}
    total_fees_paid = 0.0
    values = []
    dates = []

    for i, (date, row) in enumerate(slice_df.iterrows()):
        # Apply monthly returns
        for t in tickers:
            holdings[t] *= (1.0 + float(row[t]))

        portfolio_value = sum(holdings.values())

        # Apply AUM fee before contribution
        if monthly_fee_rate > 0:
            fee = portfolio_value * monthly_fee_rate
            total_fees_paid += fee
            ratio = (portfolio_value - fee) / portfolio_value
            for t in tickers:
                holdings[t] *= ratio
            portfolio_value -= fee

        # Annual momentum rebalance + contribution
        if i > 0 and i % 12 == 0:
            # Compute effective stock/bond split (tactical shift during inversion)
            effective_s = s
            effective_b = b
            if yc_aligned is not None and date in yc_aligned.index:
                spread_val = yc_aligned[date]
                if not pd.isna(spread_val) and spread_val < 0:
                    shift = min(tactical_shift, effective_s)
                    effective_s -= shift
                    effective_b += shift

            # Rank equity funds by trailing 12-month return (no look-ahead)
            lookback = slice_df.iloc[i - 12:i]
            cum_ret = (1 + lookback).prod() - 1
            eq_cum = cum_ret[[tickers[0], tickers[1]]]
            sorted_eq = eq_cum.sort_values()   # index[0]=bottom, index[1]=top

            # Apply concentration fractions with optional conservative floor
            b_f, t_f = bot_frac, top_frac
            if aggressiveness == "conservative" and effective_s > 0:
                min_frac = CONSERVATIVE_FLOOR / effective_s
                b_f = max(b_f, min_frac)
                t_f = 1.0 - b_f

            current_weights = {
                sorted_eq.index[0]: effective_s * b_f,
                sorted_eq.index[1]: effective_s * t_f,
                tickers[2]: effective_b,
            }

            # Add contribution then rebalance to new weights
            portfolio_value += params.monthly_contrib
            holdings = {t: portfolio_value * current_weights[t] for t in tickers}

        elif i > 0:
            # Between rebalances: add contribution proportional to drifted weights
            cur_total = sum(holdings.values())
            if cur_total > 0:
                for t in tickers:
                    holdings[t] += params.monthly_contrib * (holdings[t] / cur_total)

        values.append(sum(holdings.values()))
        dates.append(str(date.date()))

    # CPI deflation
    if deflator is not None and params.inflation_adj:
        deflator_aligned = deflator.reindex(slice_df.index, method="ffill")
        for i, date in enumerate(slice_df.index):
            if date in deflator_aligned.index and not pd.isna(deflator_aligned[date]):
                values[i] *= float(deflator_aligned[date])

    n = len(values)
    total_contributions = params.initial_amount + params.monthly_contrib * max(0, n - 1)
    final_value = values[-1] if values else 0.0
    total_gain = final_value - total_contributions

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
    diy_momentum_tickers: list = None,
    active_momentum_tickers: list = None,
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

    if diy_momentum_tickers:
        mom_str = " / ".join(diy_momentum_tickers)
        result["diy_momentum"] = {
            **simulate_momentum(
                returns_df=returns_df,
                tickers=diy_momentum_tickers,
                params=params,
                monthly_fee_rate=monthly_momentum_fee_rate,
                deflator=deflator,
                yield_curve_spread=yield_curve_spread,
                aggressiveness=aggressiveness,
            ),
            "label": f"Index Momentum ({mom_str})",
        }

    if active_momentum_tickers:
        amom_str = " / ".join(active_momentum_tickers)
        result["active_momentum"] = {
            **simulate_momentum(
                returns_df=returns_df,
                tickers=active_momentum_tickers,
                params=params,
                monthly_fee_rate=monthly_momentum_fee_rate,
                deflator=deflator,
                yield_curve_spread=yield_curve_spread,
                aggressiveness=aggressiveness,
            ),
            "label": f"Active Momentum ({amom_str})",
        }

    return result
