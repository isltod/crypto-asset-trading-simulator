# -*- coding: utf-8 -*-
"""
analyze_recent_month_vol.py
Analyze which volatility regime the most recent month has been in,
using the exact benchmark quantile thresholds from our Train dataset.
"""

import pandas as pd
import numpy as np

# Exact Thresholds from Train (2021H1 ~ 2023H1, 2.5y, 1.3M bars)
Q25 = 2.373
Q33 = 2.616
Q50 = 3.074
Q67 = 3.676
Q75 = 4.157

df = pd.read_parquet('e:/Devs/agTest/cats/scratch/recent_35d_btc_1m.parquet')
df['timestamp'] = pd.to_datetime(df['timestamp'])
c = df['close'].values
lr = np.r_[0, np.diff(np.log(c))]
df['vol_24h'] = pd.Series(lr).rolling(1440).std().values * np.sqrt(1440) * 100.0

# Warm up: drop first 1440 bars
df_valid = df.iloc[1440:].copy()

# 1. Recent 30 days: up to latest timestamp
r30_start = df_valid['timestamp'].max() - pd.Timedelta(days=30)
df_r30 = df_valid[df_valid['timestamp'] >= r30_start].copy()

# 2. September 2026: 2026-09-01 00:00 to 2026-09-30 23:59
df_sep = df_valid[(df_valid['timestamp'] >= '2026-09-01') & (df_valid['timestamp'] <= '2026-09-30 23:59:59')].copy()

# 3. August 2026 for comparison
df_aug = pd.read_parquet('E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_um/klines/symbol=BTCUSDT/interval=1m/2026-08.parquet')
df_aug['timestamp'] = pd.to_datetime(df_aug['timestamp'])
c_aug = df_aug['close'].values
lr_aug = np.r_[0, np.diff(np.log(c_aug))]
df_aug['vol_24h'] = pd.Series(lr_aug).rolling(1440).std().values * np.sqrt(1440) * 100.0
df_aug_valid = df_aug.iloc[1440:].copy()

def analyze_period(title, d):
    v = d['vol_24h'].values
    mean_v = np.mean(v)
    med_v = np.median(v)
    min_v = np.min(v)
    max_v = np.max(v)
    
    pct_q25 = (v < Q25).mean() * 100
    pct_low33 = (v < Q33).mean() * 100
    pct_mid = ((v >= Q33) & (v < Q67)).mean() * 100
    pct_high = (v >= Q67).mean() * 100
    pct_low50 = (v < Q50).mean() * 100
    pct_high50 = (v >= Q50).mean() * 100
    
    t_min = str(d['timestamp'].min())[:16]
    t_max = str(d['timestamp'].max())[:16]
    
    print("=" * 80)
    print(f" {title} [{t_min} ~ {t_max}]")
    print(f" 총 봉 수: {len(d):,}개 (약 {len(d)/1440:.1f}일)")
    print(f" 24h 변동성 요약: 평균={mean_v:.3f}%, 중앙값={med_v:.3f}%, 최소={min_v:.3f}%, 최대={max_v:.3f}%")
    print("-" * 80)
    print(f" 1) 3분위 국면 (Terciles):")
    print(f"    - 저변동 국면 (< {Q33:.3f}%):      {pct_low33:5.1f}% (시간: {int((v < Q33).sum()):,}분 / {len(d)/1440 * pct_low33/100:.1f}일)")
    print(f"    - 중변동 국면 ({Q33:.3f}~{Q67:.3f}%):  {pct_mid:5.1f}% (시간: {int(((v >= Q33) & (v < Q67)).sum()):,}분 / {len(d)/1440 * pct_mid/100:.1f}일)")
    print(f"    - 고변동 국면 (>= {Q67:.3f}%):     {pct_high:5.1f}% (시간: {int((v >= Q67).sum()):,}분 / {len(d)/1440 * pct_high/100:.1f}일)")
    print(f" 2) 중앙값 이분할 (Median Split):")
    print(f"    - 저변동 구간 (< {Q50:.3f}%):      {pct_low50:5.1f}%")
    print(f"    - 고변동 구간 (>= {Q50:.3f}%):     {pct_high50:5.1f}%")
    print(f" 3) 극저변동 구간 (< Q25 {Q25:.3f}%): {pct_q25:5.1f}%")
    print("=" * 80)
    print()

analyze_period("1. 최근 30일 (Rolling 30 Days: 9월 3일 ~ 10월 3일)", df_r30)
analyze_period("2. 2026년 9월 (Full Calendar Month: 9월 1일 ~ 9월 30일)", df_sep)
analyze_period("3. 2026년 8월 (직전 월 비교: 8월 2일 ~ 8월 31일)", df_aug_valid)

# Also breakdown recent 30 days into 4 weeks
print("\n" + "=" * 80)
print(" 최근 30일 주차별(Weekly) 변동성 추이 및 국면 변화")
print("=" * 80)
df_r30['week'] = (df_r30['timestamp'] - df_r30['timestamp'].min()).dt.days // 7
for w, g in df_r30.groupby('week'):
    w_min = str(g['timestamp'].min())[:10]
    w_max = str(g['timestamp'].max())[:10]
    wv = g['vol_24h'].values
    w_mean = np.mean(wv)
    w_low = (wv < Q33).mean() * 100
    w_mid = ((wv >= Q33) & (wv < Q67)).mean() * 100
    w_high = (wv >= Q67).mean() * 100
    
    # Major regime
    if w_low >= 50:
        regime_label = "★ 저변동 국면 우세"
    elif w_high >= 50:
        regime_label = "★ 고변동 국면 우세"
    else:
        regime_label = "중변동 / 혼조 국면"
        
    print(f" Week {w+1} ({w_min} ~ {w_max}): 평균변동성={w_mean:.3f}% | 저변동={w_low:4.1f}%, 중변동={w_mid:4.1f}%, 고변동={w_high:4.1f}% -> {regime_label}")
