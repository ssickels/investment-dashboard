"""
Diagnostic: compare yfinance return methods vs Fidelity's reported 10-year values.
Run with: python3 check_data.py
"""
import yfinance as yf
import pandas as pd

# Fidelity's reported 10-year $10k growth
EXPECTED = {
    "VTI":   40790,
    "VXUS":  25447,
    "FCNTX": 51263,
    "FIEUX": 23341,
}

def check(ticker):
    # --- Method A: auto_adjust=True (current approach) ---
    rawA = yf.download(ticker, period="10y", interval="1d", auto_adjust=True, progress=False)
    closeA = rawA["Close"][ticker] if isinstance(rawA.columns, pd.MultiIndex) else rawA["Close"]
    closeA = closeA.dropna().resample("ME").last().dropna()
    simA = 10000 * closeA.iloc[-1] / closeA.iloc[0]

    # --- Method B: raw price + dividends (manual total return) ---
    rawB = yf.download(ticker, period="10y", interval="1d", auto_adjust=False, actions=True, progress=False)
    if isinstance(rawB.columns, pd.MultiIndex):
        closeB = rawB["Close"][ticker]
        divB   = rawB["Dividends"][ticker]
    else:
        closeB = rawB["Close"]
        divB   = rawB["Dividends"]
    closeB = closeB.dropna()
    divB   = divB.reindex(closeB.index).fillna(0)

    # total return = (price + div) / prev_price each day, then compound
    tr = ((closeB + divB) / closeB.shift(1)).dropna()
    idx = (tr.cumprod() * closeB.iloc[0]).resample("ME").last().dropna()
    simB = 10000 * idx.iloc[-1] / idx.iloc[0]

    exp = EXPECTED[ticker]
    print(f"{ticker:6s}  auto_adj=${simA:>7,.0f} ({(simA-exp)/exp*100:+.1f}%)  "
          f"manual=${simB:>7,.0f} ({(simB-exp)/exp*100:+.1f}%)  "
          f"expected=${exp:,.0f}")

print(f"{'Ticker':6s}  {'auto_adjust=True':20s}  {'manual (raw+div)':20s}  expected")
for t in EXPECTED:
    check(t)
