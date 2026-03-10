# Investment Strategy Simulator

An interactive dashboard for exploring how different investment strategies perform over time, using real historical market data going back to 1987.

**Live site:** [stevessite.com/simulator](https://stevessite.com/simulator)

![Preview of the live Boids Playground, with the "Show spheres and distances" option selected](https://stevessite.com/investment_simulator_preview.jpg)

## What it does

Compare three scenarios side by side:

1. **Low-Cost Index** — Self-directed investing in low-cost index funds (VTI, VXUS, BND), with no advisory fees
2. **Advisor + Index** — Same index funds, but with an AUM-based advisory fee
3. **Advisor + Active** — Advisor steers you into actively managed funds with higher expense ratios

Adjust your starting balance, monthly contributions, time horizon, asset allocation, and fee assumptions. Toggle momentum rotation on or off. Choose between a Modern (ETF-era, from 2011) or Pre-ETF (from 1987) data set. Results update in real time.

A [User Guide](https://investment-dashboard-aapf.onrender.com/guide) explains the methodology, assumptions, and limitations in detail.

## Tech stack

- **Backend:** Python / Flask, with historical price data from [yfinance](https://github.com/ranaroussi/yfinance)
- **Frontend:** Vanilla HTML/CSS/JavaScript — no frameworks
- **Deployment:** Render (web service + Redis for caching)

## Running locally

```bash
pip install -r requirements.txt
flask run
```

Then open `http://localhost:5000`.

A Redis instance is used for caching market data but is optional locally — the app falls back gracefully if Redis is unavailable.

## Background

Built collaboratively with [Claude Code](https://claude.ai/code) in March 2026, starting from a planning conversation with [Claude AI](https://claude.ai). The simulator was my second Claude Code project, after an economic data dashboard.
