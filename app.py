"""
Flask server for the Investment Strategy Comparison Dashboard.
Single API route: GET /api/portfolio
"""
import os
from flask import Flask, jsonify, request, send_from_directory

import data as data_module
from simulator import SimParams, run_all_scenarios

app = Flask(__name__, static_folder="static", static_url_path="/static")


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/portfolio")
def portfolio():
    try:
        # Parse query params with defaults
        initial_amount = float(request.args.get("initial_amount", 10000))
        monthly_contrib = float(request.args.get("monthly_contrib", 500))
        years = int(request.args.get("years", 10))
        stock_pct = float(request.args.get("stock_pct", 80))
        rebalance = request.args.get("rebalance", "annually")
        aum_fee = float(request.args.get("aum_fee", 1.0))
        expense_ratio = float(request.args.get("expense_ratio", 0.5))
        inflation_adj = request.args.get("inflation_adj", "false").lower() == "true"

        # Validate
        initial_amount = max(1.0, initial_amount)
        monthly_contrib = max(0.0, monthly_contrib)
        stock_pct = max(0.0, min(100.0, stock_pct))
        aum_fee = max(0.0, aum_fee)
        expense_ratio = max(0.0, expense_ratio)
        if rebalance not in ("never", "annually", "quarterly"):
            rebalance = "annually"

        # Load returns data
        returns_df = data_module.load_all_returns()
        months_available = len(returns_df)
        years_available = months_available // 12
        date_range_start = str(returns_df.index[0].date())
        date_range_end = str(returns_df.index[-1].date())

        # Soft cap years
        warning = None
        if years > years_available:
            warning = (
                f"Only {years_available} years of data available "
                f"(requested {years}). Showing {years_available} years."
            )
            years = years_available

        years = max(1, years)

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

        params = SimParams(
            initial_amount=initial_amount,
            monthly_contrib=monthly_contrib,
            years=years,
            stock_pct=stock_pct,
            rebalance=rebalance,
            aum_fee_pct=aum_fee,
            expense_ratio_pct=expense_ratio,
            inflation_adj=inflation_adj,
        )

        scenarios = run_all_scenarios(returns_df, deflator, params)

        # Use dates from DIY scenario (all same length)
        dates = scenarios["diy"]["dates"]

        # Fee drag calculations
        diy_final = scenarios["diy"]["stats"]["final_value"]
        managed_final = scenarios["managed"]["stats"]["final_value"]
        active_final = scenarios["active"]["stats"]["final_value"]

        fee_drag = {
            "diy_vs_managed": round(diy_final - managed_final, 2),
            "diy_vs_active": round(diy_final - active_final, 2),
        }

        response = {
            "meta": {
                "date_range_start": date_range_start,
                "date_range_end": date_range_end,
                "months_available": months_available,
                "years_available": years_available,
                "years_simulated": years,
                "inflation_adjusted": inflation_adj,
            },
            "dates": dates,
            "scenarios": {
                "diy": {
                    "label": scenarios["diy"]["label"],
                    "values": scenarios["diy"]["values"],
                    "stats": scenarios["diy"]["stats"],
                },
                "managed": {
                    "label": scenarios["managed"]["label"],
                    "values": scenarios["managed"]["values"],
                    "stats": scenarios["managed"]["stats"],
                },
                "active": {
                    "label": scenarios["active"]["label"],
                    "values": scenarios["active"]["values"],
                    "stats": scenarios["active"]["stats"],
                },
            },
            "fee_drag": fee_drag,
            "error": warning,
        }

        return jsonify(response)

    except Exception as e:
        return jsonify({"error": str(e), "scenarios": None}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
