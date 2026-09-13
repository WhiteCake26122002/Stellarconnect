"""
Technical indicators for the stock detail chart, wrapping the `ta` package
(pure pandas/numpy, MIT licensed) so the UI layer never imports `ta` directly
and every indicator here shares one calling convention: a `Close` (or full
OHLC) pandas Series/DataFrame in, a plain Series (or tuple of Series for
multi-line indicators) out, aligned to the input's index.
"""
from __future__ import annotations

import pandas as pd
import ta


def sma(close: pd.Series, period: int) -> pd.Series:
    return ta.trend.sma_indicator(close, window=period)


def ema(close: pd.Series, period: int) -> pd.Series:
    return ta.trend.ema_indicator(close, window=period)


def dma(close: pd.Series, period: int, displacement: int = 10) -> pd.Series:
    """Displaced Moving Average: an SMA shifted forward by `displacement` bars - a classic
    trend-following overlay (not covered by the `ta` package itself, since it's just a shift)."""
    return sma(close, period).shift(displacement)


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    return ta.momentum.rsi(close, window=period)


def stoch_rsi(close: pd.Series, period: int = 14) -> tuple[pd.Series, pd.Series]:
    """Returns (%K, %D), each 0-100 (ta's raw stochrsi_k/d are 0-1 fractions)."""
    indicator = ta.momentum.StochRSIIndicator(close, window=period)
    return indicator.stochrsi_k() * 100, indicator.stochrsi_d() * 100


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (macd_line, signal_line, histogram)."""
    indicator = ta.trend.MACD(close, window_fast=fast, window_slow=slow, window_sign=signal)
    return indicator.macd(), indicator.macd_signal(), indicator.macd_diff()


def bollinger_bands(close: pd.Series, period: int = 20, std_dev: float = 2.0) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (upper, middle, lower)."""
    indicator = ta.volatility.BollingerBands(close, window=period, window_dev=std_dev)
    return indicator.bollinger_hband(), indicator.bollinger_mavg(), indicator.bollinger_lband()
