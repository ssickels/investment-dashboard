"""
Flask server for the Investment Strategy Comparison Dashboard.
Single API route: GET /api/portfolio
"""
import os
import pandas as pd
from flask import Flask, jsonify, request, send_from_directory

import data as data_module
from simulator import SimParams, run_all_scenarios

app = Flask(__name__, static_folder="static", static_url_path="/static")

DIY_PORTFOLIO_SETS = {
    "etf": {
        "label": "Modern ETFs",
        "tickers": ["VTI", "VXUS", "BND"],
        "description": "VTI / VXUS / BND",
    },
    "pre_etf": {
        "label": "Pre-ETF Index Funds",
        "tickers": ["VFINX", "VWIGX", "VBMFX"],
        "description": "VFINX / VWIGX / VBMFX",
        "note": "VWIGX (Vanguard Intl Growth) is actively managed — oldest available intl proxy",
    },
}

# Expanded momentum universe by era (equity and bond funds)
# Bonds identified per spec; all other funds treated as equity.
# Funds without sufficient history at a given rebalance date are automatically excluded.
ACTIVE_MOMENTUM_UNIVERSE = {
    "etf": {
        "equity": [
            "AGTHX", "DODFX", "FCNTX", "FIEUX", "VWUSX", "VWILX",
            "PRGFX", "PRITX", "PRTIX", "VNQ", "XLE", "XLV", "XLK",
        ],
        "bond": ["PTTAX", "FTBFX", "VBTLX"],
    },
    "pre_etf": {
        "equity": [
            "FMAGX", "FOSFX", "AGTHX", "ANWPX", "PRGFX", "PRITX",
            "FRESX", "FSENX", "FSPHX", "VGSIX",
        ],
        "bond": ["FBNDX", "ABNDX", "PRTIX"],
    },
}

ACTIVE_FUND_SETS = {
    "american_dodge": {
        "label": "American/Dodge",
        "tickers": ["AGTHX", "DODFX", "PTTAX"],
        "description": "AGTHX / DODFX / PTTAX",
        # Expense ratios: [equity_large, equity_intl, bond]
        "expense_ratios": [0.61, 0.63, 0.75],
    },
    "fidelity": {
        "label": "Fidelity",
        "tickers": ["FCNTX", "FIEUX", "FTBFX"],
        "description": "FCNTX / FIEUX / FTBFX",
        "expense_ratios": [0.39, 1.00, 0.45],
    },
    "t_rowe_price": {
        "label": "T. Rowe Price",
        "tickers": ["PRGFX", "PRITX", "PRTIX"],
        "description": "PRGFX / PRITX / PRTIX",
        "expense_ratios": [0.52, 0.82, 0.45],
    },
    "vanguard_active": {
        "label": "Vanguard Active",
        "tickers": ["VWUSX", "VWILX", "VBTLX"],
        "description": "VWUSX / VWILX / VBTLX",
        "expense_ratios": [0.38, 0.32, 0.05],
    },
    # Vintage families — work with Pre-ETF DIY, extend history to ~1987
    "fidelity_classic": {
        "label": "Fidelity Classic",
        "tickers": ["FMAGX", "FOSFX", "FBNDX"],
        "description": "FMAGX / FOSFX / FBNDX",
        "expense_ratios": [0.64, 1.01, 0.45],
    },
    "american_funds": {
        "label": "American Funds",
        "tickers": ["AGTHX", "ANWPX", "ABNDX"],
        "description": "AGTHX / ANWPX / ABNDX",
        "expense_ratios": [0.61, 0.45, 0.59],
    },
}


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/guide")
def guide():
    return send_from_directory("static", "guide.html")


@app.route("/api/portfolio")
def portfolio():
    try:
        # Parse query params with defaults
        initial_amount = float(request.args.get("initial_amount", 10000))
        monthly_contrib = float(request.args.get("monthly_contrib", 500))
        stock_pct = float(request.args.get("stock_pct", 80))
        rebalance = request.args.get("rebalance", "annually")
        aum_fee = float(request.args.get("aum_fee", 1.0))
        inflation_adj = request.args.get("inflation_adj", "false").lower() == "true"
        aggressiveness = request.args.get("aggressiveness", "moderate")
        if aggressiveness not in ("conservative", "moderate", "aggressive"):
            aggressiveness = "moderate"
        taxable = request.args.get("taxable", "true").lower() == "true"

        active_fund_set_key = request.args.get("active_fund_set", "american_dodge")
        if active_fund_set_key not in ACTIVE_FUND_SETS:
            active_fund_set_key = "american_dodge"
        active_fund_set = ACTIVE_FUND_SETS[active_fund_set_key]
        active_tickers = active_fund_set["tickers"]

        diy_portfolio_key = request.args.get("diy_portfolio", "etf")
        if diy_portfolio_key not in DIY_PORTFOLIO_SETS:
            diy_portfolio_key = "etf"
        diy_portfolio = DIY_PORTFOLIO_SETS[diy_portfolio_key]
        diy_tickers = diy_portfolio["tickers"]

        # Validate
        initial_amount = max(1.0, initial_amount)
        monthly_contrib = max(0.0, monthly_contrib)
        stock_pct = max(0.0, min(100.0, stock_pct))
        aum_fee = max(0.0, aum_fee)
        if rebalance not in ("never", "annually", "quarterly"):
            rebalance = "annually"

        # Weighted expense ratio based on stock/bond split
        er = active_fund_set["expense_ratios"]
        s = stock_pct / 100.0
        b = 1.0 - s
        weighted_er = round(0.8 * s * er[0] + 0.2 * s * er[1] + b * er[2], 4)

        # Scenario 2: AUM fee + active fund weighted ER (applied to DIY-fund returns)
        monthly_managed_fee = (1.0 + (aum_fee + weighted_er) / 100.0) ** (1.0 / 12.0) - 1.0
        # Scenario 4: AUM fee only (active fund ER already embedded in historical returns)
        monthly_active_managed_fee = (1.0 + aum_fee / 100.0) ** (1.0 / 12.0) - 1.0

        # DIY momentum: split DIY tickers into equity (first 2) and bond (last 1)
        diy_eq_tickers   = diy_tickers[:2]   # e.g. [VTI, VXUS] or [VFINX, VWIGX]
        diy_bond_tickers = diy_tickers[2:]   # e.g. [BND] or [VBMFX]

        # Active momentum: expanded universe based on era
        mom_universe = ACTIVE_MOMENTUM_UNIVERSE.get(
            diy_portfolio_key, ACTIVE_MOMENTUM_UNIVERSE["etf"]
        )
        active_eq_tickers   = mom_universe["equity"]
        active_bond_tickers = mom_universe["bond"]

        # Load standard inner-join returns (for the 4 base scenarios)
        core_tickers = list(dict.fromkeys(diy_tickers + active_tickers))
        returns_df = data_module.load_returns_for_tickers(core_tickers)

        # Load expanded outer-join returns for active momentum (graceful per-fund failure)
        expanded_returns_df = None
        try:
            expanded_returns_df = data_module.load_returns_for_tickers_outer(
                active_eq_tickers + active_bond_tickers
            )
        except Exception as exp_err:
            print(f"Warning: could not load expanded universe ({exp_err})")

        absolute_date_start = str(returns_df.index[0].date())
        absolute_date_end   = str(returns_df.index[-1].date())

        # Apply optional start date (YYYY-MM from month input)
        start_date_str = request.args.get("start_date", "")
        if start_date_str:
            try:
                start_ts = pd.Timestamp(start_date_str).to_period("M").to_timestamp("M")
                mask = returns_df.index >= start_ts
                if mask.any():
                    returns_df = returns_df[mask]
                if expanded_returns_df is not None:
                    emask = expanded_returns_df.index >= start_ts
                    if emask.any():
                        expanded_returns_df = expanded_returns_df[emask]
            except Exception:
                pass  # invalid date, use full range

        # Apply optional end date (YYYY-MM from month input)
        end_date_str = request.args.get("end_date", "")
        if end_date_str:
            try:
                end_ts = pd.Timestamp(end_date_str).to_period("M").to_timestamp("M")
                mask = returns_df.index <= end_ts
                if mask.any():
                    returns_df = returns_df[mask]
                if expanded_returns_df is not None:
                    emask = expanded_returns_df.index <= end_ts
                    if emask.any():
                        expanded_returns_df = expanded_returns_df[emask]
            except Exception:
                pass  # invalid date, use full range

        months_available = len(returns_df)
        years_available = months_available // 12
        date_range_start = str(returns_df.index[0].date())
        date_range_end = str(returns_df.index[-1].date())

        # Always simulate the full available range from the chosen start date
        years = max(1, years_available)
        warning = None

        # Load CPI / deflator
        deflator = None
        if inflation_adj:
            try:
                cpi = data_module.load_cpi_series()
                base_date = returns_df.index[-1]  # deflate to most recent month
                deflator = data_module.compute_cpi_deflator(cpi, base_date)
            except Exception as e:
                warning = f"Inflation adjustment unavailable: {e}. Showing nominal values."
                inflation_adj = False

        # Load yield curve data (graceful fallback if FRED key unavailable)
        yield_curve_spread = None
        inversion_periods = []
        try:
            yc = data_module.load_yield_curve_spread()
            yield_curve_spread = yc
            inversion_periods = data_module.compute_inversion_periods(yc)
        except Exception as yc_err:
            print(f"Warning: yield curve data unavailable ({yc_err})")

        params = SimParams(
            initial_amount=initial_amount,
            monthly_contrib=monthly_contrib,
            years=years,
            stock_pct=stock_pct,
            rebalance=rebalance,
            aum_fee_pct=aum_fee,
            inflation_adj=inflation_adj,
        )

        scenarios = run_all_scenarios(
            returns_df, deflator, params,
            diy_tickers=diy_tickers,
            active_tickers=active_tickers,
            monthly_managed_fee_rate=monthly_managed_fee,
            monthly_active_managed_fee_rate=monthly_active_managed_fee,
            diy_equity_tickers=diy_eq_tickers,
            diy_bond_tickers=diy_bond_tickers,
            active_equity_tickers=active_eq_tickers,
            active_bond_tickers=active_bond_tickers,
            expanded_returns_df=expanded_returns_df,
            monthly_momentum_fee_rate=monthly_active_managed_fee,
            yield_curve_spread=yield_curve_spread,
            aggressiveness=aggressiveness,
            taxable=taxable,
        )

        # Use dates from DIY scenario (all same length)
        dates = scenarios["diy"]["dates"]

        # Fee drag calculations
        diy_final = scenarios["diy"]["stats"]["final_value"]
        managed_final = scenarios["managed"]["stats"]["final_value"]
        active_final = scenarios["active"]["stats"]["final_value"]
        active_managed_final = scenarios["active_managed"]["stats"]["final_value"]

        fee_drag = {
            "diy_vs_managed": round(diy_final - managed_final, 2),
            "diy_vs_active": round(diy_final - active_final, 2),
            "active_vs_active_managed": round(active_final - active_managed_final, 2),
        }

        response = {
            "meta": {
                "date_range_start": date_range_start,
                "date_range_end": date_range_end,
                "months_available": months_available,
                "years_available": years_available,
                "years_simulated": years,
                "inflation_adjusted": inflation_adj,
                "absolute_date_start": absolute_date_start,
                "absolute_date_end": absolute_date_end,
            },
            "dates": dates,
            "scenarios": {
                k: {
                    "label": v["label"],
                    "values": v["values"],
                    "after_tax_values": v["after_tax_values"],
                    "stats": v["stats"],
                } if v else None
                for k, v in {
                    "diy":            scenarios["diy"],
                    "managed":        scenarios["managed"],
                    "active":         scenarios["active"],
                    "active_managed": scenarios["active_managed"],
                    "diy_momentum":    scenarios.get("diy_momentum"),
                    "active_momentum": scenarios.get("active_momentum"),
                }.items()
            },
            "fee_drag": fee_drag,
            "active_fund_set": {
                "key": active_fund_set_key,
                "label": active_fund_set["label"],
                "description": active_fund_set["description"],
                "tickers": active_tickers,
                "expense_ratios": active_fund_set["expense_ratios"],
                "weighted_expense_ratio": weighted_er,
            },
            "diy_portfolio": {
                "key": diy_portfolio_key,
                "label": diy_portfolio["label"],
                "description": diy_portfolio["description"],
                "tickers": diy_tickers,
            },
            "momentum_universe": {
                "diy_equity": diy_eq_tickers,
                "diy_bond":   diy_bond_tickers,
                "active_equity": active_eq_tickers,
                "active_bond":   active_bond_tickers,
            },
            "yield_curve_inversions": inversion_periods,
            "aggressiveness": aggressiveness,
            "taxable": taxable,
            "error": warning,
        }

        return jsonify(response)

    except Exception as e:
        return jsonify({"error": str(e), "scenarios": None}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
