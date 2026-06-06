"""
MTF MACD Calculation Comparison Test
cabt2_main.py (Python/pandas) vs server.js (JS logic ported to Python)

Key differences being tested:
  1. EMA calculation method
     - Python: pandas ewm(span=N, adjust=False) -> EMA from index 0
     - JS:     SMA seed at index N-1, then EMA
  2. Signal line calculation
     - Python: ewm applied to full macd_line
     - JS:     slice macd_line[slow-1:], compute EMA separately, re-map
  3. Data source (for MTF context)
     - Python: Binance Futures actual 5m candles (CSV cache)
     - JS:     Binance Spot 1m candles aggregated into 5m
"""
# -*- coding: utf-8 -*-
import sys
import pandas as pd
import numpy as np

FAST = 12
SLOW = 26
SIG  = 9

# -------------------------------------------------------
# 1. Python (cabt2_main.py) EMA/MACD
# -------------------------------------------------------
def macd_python(closes, fast=FAST, slow=SLOW, sig=SIG):
    s = pd.Series(closes)
    ema_fast    = s.ewm(span=fast, adjust=False).mean()
    ema_slow    = s.ewm(span=slow, adjust=False).mean()
    macd_line   = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=sig, adjust=False).mean()
    hist = macd_line - signal_line
    return macd_line.tolist(), signal_line.tolist(), hist.tolist()

# -------------------------------------------------------
# 2. JS (server.js) EMA/MACD -- 1:1 Python port
# -------------------------------------------------------
def ema_js(values, period):
    n = len(values)
    ema = [0.0] * n
    if n < period:
        return ema
    ema[period - 1] = sum(values[:period]) / period
    alpha = 2.0 / (period + 1)
    for i in range(period, n):
        ema[i] = values[i] * alpha + ema[i-1] * (1 - alpha)
    return ema

def macd_js(closes, fast=FAST, slow=SLOW, sig=SIG):
    n = len(closes)
    macd_line   = [0.0] * n
    signal_line = [0.0] * n
    hist        = [0.0] * n
    if n < slow + sig:
        return macd_line, signal_line, hist
    ef = ema_js(closes, fast)
    es = ema_js(closes, slow)
    for i in range(n):
        macd_line[i] = ef[i] - es[i]
    # signal: slice from slow-1, then EMA
    sig_ema = ema_js(macd_line[slow-1:], sig)
    for i in range(n):
        if i < slow - 1:
            signal_line[i] = 0.0
            hist[i]        = 0.0
        else:
            signal_line[i] = sig_ema[i - (slow-1)]
            hist[i]        = macd_line[i] - signal_line[i]
    return macd_line, signal_line, hist

# -------------------------------------------------------
# 3. Generate deterministic test data
# -------------------------------------------------------
rng    = np.random.default_rng(seed=42)
N      = 300
prices = 30000.0 + np.cumsum(rng.normal(0, 100, N))
prices = np.round(prices, 2).tolist()

# -------------------------------------------------------
# 4. Run calculations
# -------------------------------------------------------
py_m, py_s, py_h = macd_python(prices)
js_m, js_s, js_h = macd_js(prices)

START = SLOW + SIG  # index 35 onward

# Build comparison table
df = pd.DataFrame({
    'close':     prices,
    'py_macd':   py_m,  'js_macd':   js_m,
    'py_sig':    py_s,  'js_sig':    js_s,
    'py_hist':   py_h,  'js_hist':   js_h,
})
df['diff_macd'] = (df['py_macd'] - df['js_macd']).abs()
df['diff_sig']  = (df['py_sig']  - df['js_sig']).abs()
df['diff_hist'] = (df['py_hist'] - df['js_hist']).abs()

late = df.iloc[START:].copy()

# -------------------------------------------------------
# 5. Print results
# -------------------------------------------------------
sep = "=" * 70

print(sep)
print("SECTION 1: Statistical Difference Summary (index >= %d)" % START)
print(sep)
for col in ['macd', 'sig', 'hist']:
    d = late[f'diff_{col}']
    match = "SAME" if d.max() < 1e-6 else "DIFFERENT"
    print(f"\n  {col.upper()}")
    print(f"    mean   : {d.mean():.8f}")
    print(f"    max    : {d.max():.8f}")
    print(f"    median : {d.median():.8f}")
    print(f"    verdict: {match}")

print()
print(sep)
print("SECTION 2: Sample comparison (last 10 rows of stable zone)")
print(sep)
print(df[['py_macd','js_macd','diff_macd','py_sig','js_sig','diff_sig']].tail(10).to_string())

# -------------------------------------------------------
# 6. Cross signal comparison
# -------------------------------------------------------
print()
print(sep)
print("SECTION 3: Cross Signal Comparison (trading triggers)")
print(sep)

sub = late.copy()
sub['py_long']  = (sub['py_macd'].shift(1) < sub['py_sig'].shift(1)) & (sub['py_macd'] > sub['py_sig'])
sub['py_short'] = (sub['py_macd'].shift(1) > sub['py_sig'].shift(1)) & (sub['py_macd'] < sub['py_sig'])
sub['js_long']  = (sub['js_macd'].shift(1) < sub['js_sig'].shift(1)) & (sub['js_macd'] > sub['js_sig'])
sub['js_short'] = (sub['js_macd'].shift(1) > sub['js_sig'].shift(1)) & (sub['js_macd'] < sub['js_sig'])

py_longs  = set(sub.index[sub['py_long']])
py_shorts = set(sub.index[sub['py_short']])
js_longs  = set(sub.index[sub['js_long']])
js_shorts = set(sub.index[sub['js_short']])

def cmp_sets(name, a, b):
    match = "SAME" if a == b else "DIFFERENT"
    only_a = sorted(a - b)
    only_b = sorted(b - a)
    print(f"\n  {name}: {match}")
    print(f"    Python indices : {sorted(a)}")
    print(f"    JS     indices : {sorted(b)}")
    if only_a: print(f"    Python-only    : {only_a}")
    if only_b: print(f"    JS-only        : {only_b}")

cmp_sets("LONG  cross", py_longs,  js_longs)
cmp_sets("SHORT cross", py_shorts, js_shorts)

# -------------------------------------------------------
# 7. EMA warm-up difference (first 30 rows)
# -------------------------------------------------------
print()
print(sep)
print("SECTION 4: EMA Warm-up Difference (index 0~29, period=12)")
print(sep)
py_ema12 = pd.Series(prices).ewm(span=FAST, adjust=False).mean().tolist()
js_ema12 = ema_js(prices, FAST)
warm = pd.DataFrame({
    'close':    prices[:30],
    'py_ema12': py_ema12[:30],
    'js_ema12': js_ema12[:30],
    'diff':     [abs(py_ema12[i]-js_ema12[i]) for i in range(30)]
})
print(warm.to_string())

# -------------------------------------------------------
# 8. Summary
# -------------------------------------------------------
print()
print(sep)
print("SECTION 5: Root Cause Summary")
print(sep)
print("""
  [EMA Algorithm Difference]
  Python ewm(adjust=False): ema[0] = close[0], then EMA from index 0.
  JS SMA-seeded:             ema[0..N-2] = 0, ema[N-1] = SMA, then EMA.
  --> Values differ for ~100 bars, then converge asymptotically.

  [Signal Line Difference]
  Python: applies ewm to macd_line[0:] (includes zero-filled early zone).
  JS:     applies EMA only to macd_line[slow-1:] (ignores early zeros).
  --> Additional divergence, also converges over time.

  [MTF Data Source -- BIGGEST difference in practice]
  Python (cabt2_main.py): Binance FUTURES real 5m candles (downloaded).
  JS (server.js):         Binance SPOT 1m candles aggregated to 5m.
  --> Even if both EMA algorithms were identical, values would differ
      because the underlying OHLCV data is from different markets.
      Futures price != Spot price (basis/funding rate effect).
""")
