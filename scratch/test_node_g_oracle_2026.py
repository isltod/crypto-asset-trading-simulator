# -*- coding: utf-8 -*-
"""
test_node_g_oracle_2026.py
Compute and compare Node G's Oracle performance:
- Train period (2021-01-01 ~ 2023-06-30, 2.5y)
- 2026 YTD period (2026-01-01 ~ 2026-10-03, ~0.76y)
"""
import sys, os, glob
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9\src')
import common as C
import pandas as pd
import numpy as np

def evaluate_oracle(df, label):
    c = df.close.values
    ts = pd.to_datetime(df.timestamp.values)
    n_days = (ts[-1] - ts[0]).total_seconds() / 86400.0
    years = n_days / 365.25
    
    # 24h OLS band & rolling zscores
    ev = df.index >= 1440
    zU, zL = C.band(df)
    z_ret, z_vol, lr = C.zscores(df)
    
    nodes, dirs = C.g_nodes(df, ev, zU, zL, z_ret, z_vol, lr, zr=4.0, zv=5.0, k=1.0)
    segs = C.segments(nodes, dirs)
    
    # Calculate oracle return for each segment
    records = []
    for s, e, d in segs:
        ret_oracle = d * (c[e] - c[s]) / c[s] * 100.0
        dur_hours = (ts[e] - ts[s]).total_seconds() / 3600.0
        records.append({
            'start_ts': ts[s], 'end_ts': ts[e],
            'start_idx': s, 'end_idx': e, 'dir': d,
            'is_single': (s == e),
            'nodes_count': np.sum((nodes >= s) & (nodes <= e)),
            'dur_hours': dur_hours,
            'oracle': ret_oracle
        })
    df_seg = pd.DataFrame(records)
    
    # Also evaluate Flip (SAR: from start of current segment to start of next segment)
    flips = []
    for i in range(len(segs) - 1):
        s1, e1, d1 = segs[i]
        s2, e2, d2 = segs[i+1]
        r_flip = d1 * (c[s2] - c[s1]) / c[s1] * 100.0 - 0.08 # 8bp cost
        flips.append(r_flip)
    flips = np.array(flips)
    
    print(f"\n=======================================================")
    print(f" [{label}] 노드 G 오라클 및 세그먼트 전수 분석")
    print(f" 기간: {ts[0].strftime('%Y-%m-%d')} ~ {ts[-1].strftime('%Y-%m-%d')} ({n_days:.1f}일, {years:.2f}년)")
    print(f"=======================================================")
    print(f" 총 노드 G 발생 수: {len(nodes):,}개 (일평균 {len(nodes)/n_days:.2f}개)")
    print(f" 총 세그먼트 수:    {len(df_seg):,}개 (연평균 {len(df_seg)/years:.1f}개)")
    print(f" 단일 노드 세그먼트: {df_seg['is_single'].sum():,}개 ({df_seg['is_single'].mean()*100:.1f}%)")
    print(f" 다중 노드 세그먼트: {(~df_seg['is_single']).sum():,}개 ({(~df_seg['is_single']).mean()*100:.1f}%)")
    print(f" 세그먼트 길이(시간): 중앙값 {df_seg['dur_hours'].median():.2f}h, 평균 {df_seg['dur_hours'].mean():.2f}h")
    print(f"-------------------------------------------------------")
    print(f" [오라클 성과 지표 (Theoretical Oracle)]")
    print(f" * 세그먼트당 오라클 평균 수익: {df_seg['oracle'].mean():+.3f}%")
    print(f" * 세그먼트당 오라클 중앙값:    {df_seg['oracle'].median():+.3f}%")
    print(f" * 오라클 승률 (수익 > 0):       {(df_seg['oracle'] > 0).mean()*100:.1f}%")
    print(f" * 다중 노드 세그먼트 평균 오라클: {df_seg[~df_seg['is_single']]['oracle'].mean():+.3f}%")
    print(f" * 연간 오라클 총 수익 (누적 합): {df_seg['oracle'].sum() / years:+.1f}% / 년")
    print(f" * 기간 전체 오라클 누적 합:     {df_seg['oracle'].sum():+.1f}%")
    print(f"-------------------------------------------------------")
    print(f" [현실적 Flip (SAR) 비교 지표 (비용 8bp 차감 후)]")
    print(f" * 세그먼트당 SAR 평균 손익:   {flips.mean():+.3f}%")
    print(f" * SAR 승률 (수익 > 0):         {(flips > 0).mean()*100:.1f}%")
    print(f" * 연간 SAR 누적 합:            {flips.sum() / years:+.1f}% / 년")
    print(f" * 오라클 - SAR 괴리 (갭 손실): {df_seg['oracle'].mean() - flips.mean():+.3f}%p")
    
    return df_seg, flips

def main():
    # 1. Train dataset
    print("Loading Train dataset (2021H1 ~ 2023H1)...")
    df_tr = C.load_data()
    # Filter strictly to 2021-01-01 ~ 2023-06-30
    df_tr = df_tr[(df_tr.timestamp >= '2021-01-01') & (df_tr.timestamp <= '2023-06-30 23:59:59')].reset_index(drop=True)
    df_seg_tr, flips_tr = evaluate_oracle(df_tr, "과거 Train (2021~2023.06)")
    
    # 2. 2026 dataset
    print("\nLoading 2026 YTD dataset...")
    files_2026 = sorted(glob.glob('E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_um/klines/symbol=BTCUSDT/interval=1m/2026-*.parquet'))
    dfs = [pd.read_parquet(f) for f in files_2026]
    dfs.append(pd.read_parquet('e:/Devs/agTest/cats/scratch/recent_35d_btc_1m.parquet'))
    df_26 = pd.concat(dfs, ignore_index=True).drop_duplicates(subset=['timestamp']).sort_values('timestamp').reset_index(drop=True)
    df_26 = df_26[(df_26.timestamp >= '2026-01-01') & (df_26.timestamp <= '2026-10-03 23:59:59')].reset_index(drop=True)
    df_seg_26, flips_26 = evaluate_oracle(df_26, "올해 2026 YTD (2026.01~2026.10)")

if __name__ == '__main__':
    main()
