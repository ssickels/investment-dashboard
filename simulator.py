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


def compute_weights(stock_pct: float) -> dict:
    """
    VTI = 80% of equity, VXUS = 20% of equity, BND = bonds.
    Returns weights summing to 1.0.
    """
    s = stock_pct / 100.0
    b = 1.0 - s
    return {
        "VTI": 0.8 * s,
        "VXUS": 0.2 * s,
        "BND": b,
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


def run_all_scenarios(
    returns_df: pd.DataFrame,
    deflator: Optional[pd.Series],
    params: SimParams,
    active_tickers: list = None,
    monthly_managed_fee_rate: float = 0.0,
    monthly_active_managed_fee_rate: float = 0.0,
) -> dict:
    """
    Run all 4 investment scenarios.

    Scenario 1 (DIY): VTI/VXUS/BND, no extra fees
    Scenario 2 (Fee-Adjusted Managed): same weights, AUM + active fund expense ratio
    Scenario 3 (Actively Managed): active tickers, expense ratio already in returns
    Scenario 4 (Fee-Adjusted Active): active tickers, AUM fee only (ER already in returns)
    """
    weights = compute_weights(params.stock_pct)

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
        tickers=["VTI", "VXUS", "BND"],
        weights=weights,
        params=params,
        monthly_fee_rate=0.0,
        deflator=deflator,
    )

    managed = simulate(
        returns_df=returns_df,
        tickers=["VTI", "VXUS", "BND"],
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

    ticker_str = " / ".join(active_tickers)
    return {
        "diy": {**diy, "label": "DIY Index (VTI/VXUS/BND)"},
        "managed": {**managed, "label": "Fee-Adjusted Managed"},
        "active": {**active, "label": f"Actively Managed ({ticker_str})"},
        "active_managed": {**active_managed, "label": f"Fee-Adjusted Active ({ticker_str})"},
    }
