"""
Tests for backend/trading/technical_indicators.py - pure pandas/numpy math
wrapping the `ta` package. No network.
"""
import pandas as pd
import pytest

from ..trading import technical_indicators as ti


def _flat_series(value: float, n: int = 60) -> pd.Series:
    return pd.Series([value] * n)


def _trending_series(start: float, step: float, n: int = 60) -> pd.Series:
    return pd.Series([start + step * i for i in range(n)])


def test_sma_of_flat_series_equals_the_flat_value():
    close = _flat_series(100.0)
    result = ti.sma(close, period=10)
    assert result.iloc[-1] == pytest.approx(100.0)


def test_ema_reacts_faster_than_sma_to_a_recent_jump():
    close = pd.concat([_flat_series(100.0, 40), _flat_series(200.0, 20)], ignore_index=True)
    sma = ti.sma(close, period=20)
    ema = ti.ema(close, period=20)
    # At the first post-jump bar, EMA puts more weight on that single new value than SMA's
    # flat 1/period weighting does (2/(period+1) vs 1/period), so EMA should already sit
    # further above the old 100 level than SMA does.
    jump_index = 40
    assert ema.iloc[jump_index] > sma.iloc[jump_index]


def test_dma_is_sma_shifted_forward_by_displacement():
    close = _trending_series(100.0, 1.0)
    sma = ti.sma(close, period=10)
    dma = ti.dma(close, period=10, displacement=5)
    assert dma.iloc[-1] == pytest.approx(sma.iloc[-6])


def test_rsi_of_strictly_rising_series_approaches_100():
    close = _trending_series(100.0, 1.0)
    result = ti.rsi(close, period=14)
    assert result.iloc[-1] > 95.0


def test_rsi_of_strictly_falling_series_approaches_zero():
    close = _trending_series(200.0, -1.0)
    result = ti.rsi(close, period=14)
    assert result.iloc[-1] < 5.0


def test_stoch_rsi_returns_two_series_bounded_0_to_100():
    close = pd.Series([100 + 10 * ((i % 20) / 20) for i in range(80)])
    k, d = ti.stoch_rsi(close, period=14)
    valid_k = k.dropna()
    valid_d = d.dropna()
    assert not valid_k.empty and not valid_d.empty
    assert valid_k.between(-1e-6, 100 + 1e-6).all()
    assert valid_d.between(-1e-6, 100 + 1e-6).all()


def test_macd_line_is_positive_when_fast_ema_above_slow_ema():
    close = _trending_series(100.0, 2.0, n=80)
    macd_line, signal_line, histogram = ti.macd(close)
    assert macd_line.iloc[-1] > 0
    assert histogram.iloc[-1] == pytest.approx(macd_line.iloc[-1] - signal_line.iloc[-1], abs=1e-6)


def test_bollinger_bands_upper_above_middle_above_lower():
    close = pd.Series([100 + (i % 7) for i in range(60)])
    upper, mid, lower = ti.bollinger_bands(close, period=20)
    i = -1
    assert upper.iloc[i] > mid.iloc[i] > lower.iloc[i]


def test_bollinger_bands_widen_with_higher_volatility():
    calm = pd.Series([100 + 0.1 * (i % 2) for i in range(60)])
    volatile = pd.Series([100 + 10 * (i % 2) for i in range(60)])
    calm_upper, _, calm_lower = ti.bollinger_bands(calm, period=20)
    vol_upper, _, vol_lower = ti.bollinger_bands(volatile, period=20)
    assert (vol_upper.iloc[-1] - vol_lower.iloc[-1]) > (calm_upper.iloc[-1] - calm_lower.iloc[-1])
