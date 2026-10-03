# -*- coding: utf-8 -*-
"""
analyze_2026_volatility.py
Analyze 2026 full-year volatility and find where the recent month ranks.
"""

import glob, os
import pandas as pd
import numpy as np

# Load all 2026 parquet files from datalake
files_2026 = sorted(glob.glob('E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_um/klines/symbol=BTCUSDT/interval=1m/2026-*.parquet'))
print('Found 2026 monthly files:', [os.path.basename(f) for f in files_2026])

dfs = [pd.read_parquet(f) for f in files_2026]
# Also add recent 35d to cover Sep and early Oct
df_recent = pd.read_parquet('e:/Devs/agTest/cats/scratch/recent_35d_btc_1m.parquet')
dfs.append(df_recent)

df_all = pd.concat(dfs, ignore_index=True)
df_all.drop_duplicates(subset=['timestamp'], inplace=True)
df_all.sort_values('timestamp', inplace=True)
df_all.reset_index(drop=True, inplace=True)

t_min = str(df_all['timestamp'].min())[:16]
t_max = str(df_all['timestamp'].max())[:16]
print(f"2026 Combined data: {t_min} to {t_max}, total bars: {len(df_all):,}")

# Calculate 24h rolling volatility (1440 bars)
c = df_all['close'].values
lr = np.r_[0, np.diff(np.log(c))]
df_all['vol_24h'] = pd.Series(lr).rolling(1440).std().values * np.sqrt(1440) * 100.0

# Warm up: drop first 1440 bars
df_valid = df_all.iloc[1440:].copy()
df_valid['month'] = pd.to_datetime(df_valid['timestamp']).dt.to_period('M')

m_stats = []
for m, g in df_valid.groupby('month'):
    v = g['vol_24h'].dropna().values
    if len(v) == 0: continue
    m_stats.append({
        'month': str(m),
        'mean_vol': np.mean(v),
        'median_vol': np.median(v),
        'min_vol': np.min(v),
        'max_vol': np.max(v),
        'days': len(g) / 1440.0
    })

df_m = pd.DataFrame(m_stats)
# Sort by mean_vol ascending (1 = lowest)
df_m['rank_asc'] = df_m['mean_vol'].rank(ascending=True).astype(int)

# Recent 30 days
r30_start = df_valid['timestamp'].max() - pd.Timedelta(days=30)
df_r30 = df_valid[df_valid['timestamp'] >= r30_start]
v_r30 = df_r30['vol_24h'].dropna().values

year_mean = df_valid['vol_24h'].dropna().mean()
year_median = df_valid['vol_24h'].dropna().median()

print("\n" + "=" * 85)
print(" 2026년 월별 24시간 롤링 변동성 순위 (1위 = 올해 최저 변동성)")
print("=" * 85)
df_m_sorted = df_m.sort_values('mean_vol').reset_index(drop=True)
for idx, r in df_m_sorted.iterrows():
    marker = "★ [최근 1달]" if r['month'] == '2026-09' else ("(진행중)" if r['month'] == '2026-10' else "")
    print(f" {idx+1}위: {r['month']} | 평균={r['mean_vol']:5.3f}%, 중앙값={r['median_vol']:5.3f}%, 범위=[{r['min_vol']:5.3f}% ~ {r['max_vol']:5.3f}%] ({r['days']:4.1f}일) {marker}")

print("\n" + "=" * 85)
print(" 2026년 올해 전체 대비 최근 1달 수준 비교 요약")
print("=" * 85)
print(f" - 2026년 올해 전체(1월~10월) 평균 변동성: {year_mean:.3f}% (중앙값: {year_median:.3f}%)")
print(f" - 최근 30일 (9/3 ~ 10/3) 평균 변동성:       {np.mean(v_r30):.3f}% (중앙값: {np.median(v_r30):.3f}%)")
print(f" - 2026년 9월 (캘린더 월) 평균 변동성:       {df_m[df_m['month']=='2026-09']['mean_vol'].values[0]:.3f}%")
print(f" - 2026년 8월 (직전 월) 평균 변동성:         {df_m[df_m['month']=='2026-08']['mean_vol'].values[0]:.3f}%")

ratio = np.mean(v_r30) / year_mean * 100
print(f"\n -> 최근 30일 변동성은 2026년 올해 전체 평균의 약 {ratio:.1f}% 수준으로 대폭 축소된 상태입니다.")
