# -*- coding: utf-8 -*-
"""
test_fork9_full_year_2026.py
Backtest Fork 9 Rank 1 & Rank 2 across the entirety of 2026 (Jan 1 ~ Oct 3),
inspecting month-by-month PnL, MDD, win rates, and YTD performance.
"""

import glob, os, sys
sys.path.insert(0, r'e:\Devs\agTest\cats\scratch')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9\src')
import common as C
import pandas as pd
import numpy as np
from test_vol_significance import run_detailed_sim

def main():
    print("Loading all 2026 kline data...")
    files_2026 = sorted(glob.glob('E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_um/klines/symbol=BTCUSDT/interval=1m/2026-*.parquet'))
    dfs = [pd.read_parquet(f) for f in files_2026]
    df_recent = pd.read_parquet('e:/Devs/agTest/cats/scratch/recent_35d_btc_1m.parquet')
    dfs.append(df_recent)
    
    df_all = pd.concat(dfs, ignore_index=True)
    df_all.drop_duplicates(subset=['timestamp'], inplace=True)
    df_all.sort_values('timestamp', inplace=True)
    df_all.reset_index(drop=True, inplace=True)
    
    print(f"2026 Total data: {df_all['timestamp'].min()} to {df_all['timestamp'].max()} ({len(df_all):,} bars)")
    
    # Eval mask: after 24h warm up
    ev = df_all.index >= 1440
    zU, zL = C.band(df_all)
    z_ret, z_vol, lr = C.zscores(df_all)
    defs = C.all_node_defs(df_all, ev, zU, zL, z_ret, z_vol, lr)
    
    c = df_all.close.values
    timestamps = df_all.timestamp.values
    halves = ['2026H1' if ts < '2026-07-01' else '2026H2' for ts in df_all.timestamp.astype(str)]
    
    gt, gd = defs['G']
    node_dict = dict(zip(gt, gd))
    
    print(f"Node G signals generated in 2026: {len(node_dict)}")
    
    print("Simulating Rank 1 (1D: R, r_cut=-0.41)...")
    df_r1 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=None)
    
    print("Simulating Rank 2 (2D: R+RV, r_cut=-0.41, rv_cut=48.4)...")
    df_r2 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=48.4)
    
    # Filter trades after 2026-01-02 to ensure warmup
    df_r1 = df_r1[df_r1['timestamp'] >= '2026-01-02'].copy()
    df_r2 = df_r2[df_r2['timestamp'] >= '2026-01-02'].copy()
    
    df_r1['month'] = pd.to_datetime(df_r1['timestamp']).dt.to_period('M')
    df_r2['month'] = pd.to_datetime(df_r2['timestamp']).dt.to_period('M')
    
    # Monthly PnL aggregation
    m_r1 = df_r1.groupby('month').agg(
        trades=('r', 'count'),
        flips=('type', lambda s: (s == 'flip').sum()),
        gross_pnl=('r', 'sum'),
        win_rate=('r', lambda s: (s > 0).mean() * 100)
    )
    m_r1['net_pnl_8bp'] = m_r1['gross_pnl'] - m_r1['trades'] * 0.08
    
    m_r2 = df_r2.groupby('month').agg(
        trades=('r', 'count'),
        flips=('type', lambda s: (s == 'flip').sum()),
        gross_pnl=('r', 'sum'),
        win_rate=('r', lambda s: (s > 0).mean() * 100)
    )
    m_r2['net_pnl_8bp'] = m_r2['gross_pnl'] - m_r2['trades'] * 0.08
    
    # Monthly market volatility
    df_all_ev = df_all.iloc[1440:].copy()
    df_all_ev['month'] = df_all_ev['timestamp'].dt.to_period('M')
    m_vol = df_all_ev.groupby('month').apply(lambda g: g['close'].pct_change().std() * np.sqrt(1440) * 100.0)
    m_btc_ret = df_all_ev.groupby('month').apply(lambda g: (g['close'].iloc[-1] / g['close'].iloc[0] - 1) * 100.0)
    
    all_months = sorted(df_all_ev['month'].unique())
    
    records = []
    cum1 = cum2 = 0.0
    for m in all_months:
        r1_row = m_r1.loc[m] if m in m_r1.index else None
        r2_row = m_r2.loc[m] if m in m_r2.index else None
        
        n1 = r1_row['net_pnl_8bp'] if r1_row is not None else 0.0
        n2 = r2_row['net_pnl_8bp'] if r2_row is not None else 0.0
        t1 = int(r1_row['trades']) if r1_row is not None else 0
        t2 = int(r2_row['trades']) if r2_row is not None else 0
        f1 = int(r1_row['flips']) if r1_row is not None else 0
        f2 = int(r2_row['flips']) if r2_row is not None else 0
        
        cum1 += n1
        cum2 += n2
        v = m_vol.get(m, 0.0)
        bret = m_btc_ret.get(m, 0.0)
        
        records.append({
            'Month': str(m),
            'Mkt_Vol': v,
            'BTC_Ret': bret,
            'R1_Net': n1,
            'R1_Cum': cum1,
            'R1_Trades': t1,
            'R1_Flips': f1,
            'R2_Net': n2,
            'R2_Cum': cum2,
            'R2_Trades': t2,
            'R2_Flips': f2,
            'Diff_Net': n2 - n1
        })
        
    df_table = pd.DataFrame(records)
    print("\n" + "=" * 115)
    print(" 2026년 월별 포크 9 후보 1 vs 후보 2 실측 성적표 (YTD: 2026.01 ~ 2026.10)")
    print("=" * 115)
    for _, row in df_table.iterrows():
        print(f" {row['Month']} | 변동성={row['Mkt_Vol']:4.2f}% | BTC={row['BTC_Ret']:+6.1f}% || R1: Net={row['R1_Net']:+6.1f}% (누적={row['R1_Cum']:+6.1f}%, 플립={row['R1_Flips']:2d}) || R2: Net={row['R2_Net']:+6.1f}% (누적={row['R2_Cum']:+6.1f}%, 플립={row['R2_Flips']:2d}) || R2 우위={row['Diff_Net']:+5.1f}%p")
        
    # Full Year summary
    r1_arr = df_r1['r'].values
    r2_arr = df_r2['r'].values
    
    tot_net1 = r1_arr.sum() - len(df_r1) * 0.08
    tot_net2 = r2_arr.sum() - len(df_r2) * 0.08
    
    cum_arr1 = np.cumsum(r1_arr - 0.08)
    cum_arr2 = np.cumsum(r2_arr - 0.08)
    mdd1 = np.max(np.maximum.accumulate(cum_arr1) - cum_arr1) if len(cum_arr1) > 0 else 0.0
    mdd2 = np.max(np.maximum.accumulate(cum_arr2) - cum_arr2) if len(cum_arr2) > 0 else 0.0
    
    print("\n" + "=" * 85)
    print(" 2026년 연간 누적 성적 요약 (YTD: 2026-01-02 ~ 2026-10-03)")
    print("=" * 85)
    print(f" - 1위 (`1D: R`):    총 거래={len(df_r1)}회, 총 플립={df_table['R1_Flips'].sum()}회 | 2026 YTD 순수익={tot_net1:+6.1f}% | MDD={mdd1:4.1f}%")
    print(f" - 2위 (`2D: R+RV`): 총 거래={len(df_r2)}회, 총 플립={df_table['R2_Flips'].sum()}회 | 2026 YTD 순수익={tot_net2:+6.1f}% | MDD={mdd2:4.1f}%")

if __name__ == '__main__':
    main()
