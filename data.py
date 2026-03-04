"""
Data fetching module: yfinance prices + FRED CPI.
All date indexes normalized to month-end for alignment.

Cache: Redis if REDIS_URL is set, otherwise local file cache.
"""
import os
import json
import datetime
import requests
import pandas as pd
import yfinance as yf
from dotenv import load_dotenv

load_dotenv()

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
CACHE_TTL_HOURS = 24
CACHE_TTL_SECONDS = CACHE_TTL_HOURS * 3600

# --------------- Redis (optional) ---------------

_redis_client = None

def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    url = os.getenv("REDIS_URL")
    if not url:
        return None
    try:
        import redis
        r = redis.from_url(url)
        r.ping()
        _redis_client = r
        return r
    except Exception as e:
        print(f"Warning: Redis unavailable ({e}), falling back to file cache")
        return None

DIY_TICKERS = ["VTI", "VXUS", "BND"]
ACTIVE_TICKERS = ["AGTHX", "DODFX", "PTTAX"]
ALL_ACTIVE_TICKERS = [
    # Core active (modern)
    "AGTHX", "DODFX", "PTTAX",
    "FCNTX", "FIEUX", "FTBFX",
    "PRGFX", "PRITX", "PRTIX",
    "VWUSX", "VWILX", "VBTLX",
    # Core active (pre-ETF)
    "FMAGX", "FOSFX", "FBNDX",
    "ANWPX", "ABNDX",
    # Sector — pre-ETF
    "FRESX", "FSENX", "FSPHX", "VGSIX",
    # Sector ETFs — modern
    "VNQ", "XLE", "XLV", "XLK",
]
ALL_TICKERS = DIY_TICKERS + ALL_ACTIVE_TICKERS


# --------------- Cache interface ---------------

def _load_cache(key: str):
    r = _get_redis()
    if r:
        val = r.get(f"cache:v3:{key}")
        if val is None:
            return None
        # Redis TTL handles freshness; return with a current timestamp so
        # _cache_is_fresh() always passes for Redis-loaded data.
        return {"fetched_at": datetime.datetime.utcnow().isoformat(), "data": json.loads(val)}

    path = os.path.join(CACHE_DIR, f"{key}.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def _save_cache(key: str, data: dict):
    r = _get_redis()
    if r:
        r.setex(f"cache:v3:{key}", CACHE_TTL_SECONDS, json.dumps(data))
        return

    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{key}.json")
    payload = {
        "fetched_at": datetime.datetime.utcnow().isoformat(),
        "data": data,
    }
    with open(path, "w") as f:
        json.dump(payload, f)


def _cache_is_fresh(cached: dict) -> bool:
    fetched = datetime.datetime.fromisoformat(cached["fetched_at"])
    age = datetime.datetime.utcnow() - fetched
    return age.total_seconds() < CACHE_TTL_SECONDS


def _normalize_to_month_end(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Convert any date index to month-end timestamps for consistent alignment."""
    return pd.DatetimeIndex(idx).to_period("M").to_timestamp("M")


def load_price_series(ticker: str) -> pd.Series:
    """
    Fetch monthly adjusted close prices for a ticker.
    Caches to cache/{ticker}.json with 24hr TTL.
    Falls back to stale cache on fetch failure.
    """
    cached = _load_cache(ticker)

    if cached and _cache_is_fresh(cached):
        data = cached["data"]
        s = pd.Series(data)
        s.index = pd.to_datetime(s.index)
        return s

    try:
        raw = yf.download(ticker, period="max", interval="1mo", auto_adjust=True, progress=False)
        if raw.empty:
            raise ValueError(f"No data returned for {ticker}")

        # Handle multi-level columns from newer yfinance versions
        if isinstance(raw.columns, pd.MultiIndex):
            close = raw["Close"][ticker]
        else:
            close = raw["Close"]

        close = close.dropna()
        close.index = _normalize_to_month_end(close.index)
        # Remove duplicate month-end dates (keep last)
        close = close[~close.index.duplicated(keep="last")]
        close = close.sort_index()

        data_dict = {str(d.date()): float(v) for d, v in close.items()}
        _save_cache(ticker, data_dict)
        return close

    except Exception as e:
        if cached:
            print(f"Warning: fetch failed for {ticker} ({e}), using stale cache")
            data = cached["data"]
            s = pd.Series(data)
            s.index = pd.to_datetime(s.index)
            return s
        raise RuntimeError(f"Cannot load {ticker}: {e}") from e


def load_monthly_returns(ticker: str) -> pd.Series:
    """Compute monthly pct_change on full history, then drop first NaN."""
    prices = load_price_series(ticker)
    returns = prices.pct_change().dropna()
    return returns


def load_returns_for_tickers(tickers: list) -> pd.DataFrame:
    """Load and inner-join monthly returns for a specific set of tickers."""
    series = {t: load_monthly_returns(t) for t in tickers}
    df = pd.concat(series, axis=1)
    df = df.dropna()
    df.index = _normalize_to_month_end(df.index)
    return df


def load_returns_for_tickers_outer(tickers: list) -> pd.DataFrame:
    """
    Load monthly returns with outer-join: NaN where a fund wasn't yet trading.
    Per-ticker failures are skipped with a warning rather than raising.
    Used for the expanded momentum universe where funds have staggered inception dates.
    """
    series = {}
    for t in tickers:
        try:
            series[t] = load_monthly_returns(t)
        except Exception as e:
            print(f"Warning: skipping {t} for expanded universe ({e})")
    if not series:
        return pd.DataFrame()
    df = pd.concat(series, axis=1)
    df.index = _normalize_to_month_end(df.index)
    return df


def load_all_returns() -> pd.DataFrame:
    """
    Load DIY + default active tickers, inner join (dropna).
    Common start is approximately 2011-09 due to VXUS inception.
    """
    return load_returns_for_tickers(DIY_TICKERS + ACTIVE_TICKERS)


def get_common_date_range() -> tuple[str, str]:
    """Returns (start_str, end_str) for the common date range as ISO strings."""
    df = load_all_returns()
    start = df.index[0].date()
    end = df.index[-1].date()
    return str(start), str(end)


def load_cpi_series() -> pd.Series:
    """
    Fetch CPIAUCSL from FRED API.
    Caches to cache/CPIAUCSL.json with 24hr TTL.
    """
    key = "CPIAUCSL"
    cached = _load_cache(key)

    if cached and _cache_is_fresh(cached):
        data = cached["data"]
        s = pd.Series(data, dtype=float)
        s.index = pd.to_datetime(s.index)
        return s

    api_key = os.getenv("FRED_API_KEY", "")
    if not api_key or api_key == "your_key_here":
        if cached:
            print("Warning: FRED_API_KEY not set, using cached CPI")
            data = cached["data"]
            s = pd.Series(data, dtype=float)
            s.index = pd.to_datetime(s.index)
            return s
        raise RuntimeError("FRED_API_KEY not configured in .env")

    url = (
        "https://api.stlouisfed.org/fred/series/observations"
        f"?series_id=CPIAUCSL&api_key={api_key}&file_type=json"
        "&observation_start=2000-01-01"
    )
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        obs = resp.json()["observations"]

        data_dict = {}
        for o in obs:
            if o["value"] != ".":
                data_dict[o["date"]] = float(o["value"])

        _save_cache(key, data_dict)

        s = pd.Series(data_dict, dtype=float)
        s.index = pd.to_datetime(s.index)
        s.index = _normalize_to_month_end(s.index)
        return s

    except Exception as e:
        if cached:
            print(f"Warning: FRED fetch failed ({e}), using stale cache")
            data = cached["data"]
            s = pd.Series(data, dtype=float)
            s.index = pd.to_datetime(s.index)
            return s
        raise RuntimeError(f"Cannot load CPI: {e}") from e


def load_yield_curve_spread() -> pd.Series:
    """
    Fetch T10Y2Y (10-Year minus 2-Year Treasury spread) from FRED.
    Negative values indicate yield curve inversion.
    Resamples daily FRED data to monthly (month-end mean) before caching.
    """
    key = "T10Y2Y"
    cached = _load_cache(key)

    if cached and _cache_is_fresh(cached):
        data = cached["data"]
        s = pd.Series(data, dtype=float)
        s.index = pd.to_datetime(s.index)
        return s

    api_key = os.getenv("FRED_API_KEY", "")
    if not api_key or api_key == "your_key_here":
        if cached:
            print("Warning: FRED_API_KEY not set, using cached T10Y2Y")
            data = cached["data"]
            s = pd.Series(data, dtype=float)
            s.index = pd.to_datetime(s.index)
            return s
        raise RuntimeError("FRED_API_KEY not configured — yield curve data unavailable")

    url = (
        "https://api.stlouisfed.org/fred/series/observations"
        f"?series_id=T10Y2Y&api_key={api_key}&file_type=json"
        "&observation_start=1985-01-01"
    )
    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
        obs = resp.json()["observations"]

        daily = {}
        for o in obs:
            if o["value"] != ".":
                daily[o["date"]] = float(o["value"])

        s_daily = pd.Series(daily, dtype=float)
        s_daily.index = pd.to_datetime(s_daily.index)
        # Resample daily → monthly mean, then normalize to month-end
        s_monthly = s_daily.resample("ME").mean().dropna()
        s_monthly.index = _normalize_to_month_end(s_monthly.index)

        monthly_dict = {str(d.date()): float(v) for d, v in s_monthly.items()}
        _save_cache(key, monthly_dict)
        return s_monthly

    except Exception as e:
        if cached:
            print(f"Warning: FRED T10Y2Y fetch failed ({e}), using stale cache")
            data = cached["data"]
            s = pd.Series(data, dtype=float)
            s.index = pd.to_datetime(s.index)
            return s
        raise RuntimeError(f"Cannot load yield curve spread: {e}") from e


def compute_inversion_periods(spread: pd.Series) -> list:
    """
    Given a monthly T10Y2Y spread series, return a list of contiguous inversion
    periods as [{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}].
    """
    inverted = spread < 0
    periods = []
    in_inversion = False
    start_date = None
    for date, is_inv in inverted.items():
        if is_inv and not in_inversion:
            in_inversion = True
            start_date = date
        elif not is_inv and in_inversion:
            in_inversion = False
            periods.append({"start": str(start_date.date()), "end": str(date.date())})
    if in_inversion and start_date is not None:
        periods.append({"start": str(start_date.date()), "end": str(spread.index[-1].date())})
    return periods


def compute_cpi_deflator(cpi: pd.Series, base_date: pd.Timestamp) -> pd.Series:
    """
    Returns cpi[base_date] / cpi[t] — values < 1 for dates before base,
    values > 1 for dates after base (inflation erodes purchasing power).
    Reindexes to fill trailing months without CPI data.
    """
    cpi_norm = cpi.copy()
    cpi_norm.index = _normalize_to_month_end(cpi_norm.index)
    cpi_norm = cpi_norm[~cpi_norm.index.duplicated(keep="last")]

    # Find base value (use nearest available if exact not found)
    if base_date in cpi_norm.index:
        base_val = cpi_norm[base_date]
    else:
        base_val = cpi_norm.iloc[-1]

    deflator = base_val / cpi_norm
    return deflator
