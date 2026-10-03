# -*- coding: utf-8 -*-
"""
analyze_negative_months.py
Examine the frequency and distribution of negative monthly returns for Rank 1 & Rank 2
across Train (2.5 years, 30 months) and the full 5.5-year history (66 months).
"""
import sys, os, glob
sys.path.insert(0, r'e:\Devs\agTest\cats\scratch')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9\src')
import common as C
import pandas as pd
import numpy as np
from test_vol_significance import run_detailed_sim

def run_dataset_monthly(df, eval_start, dataset_name):
    df = df.copy()
    df.sort_values("timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)
    ev = (df["timestamp"] >= eval_start).values
    zU, zL = C.band(df)
    z_ret, z_vol, lr = C.zscores(df)
    defs = C.all_node_defs(df, ev, zU, zL, z_ret, z_vol, lr)
    
    c = df.close.values
    timestamps = df.timestamp.values
    halves = (df.timestamp.dt.year.astype(str) + "H" + ((df.timestamp.dt.month - 1) // 6 + 1).astype(str)).values
    
    gt, gd = defs['G']
    node_dict = dict(zip(gt, gd))
    
    df_r1 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=None)
    df_r2 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=48.4)
    
    # Filter only trades after eval_start
    df_r1 = df_r1[df_r1["timestamp"] >= eval_start].copy()
    df_r2 = df_r2[df_r2["timestamp"] >= eval_start].copy()
    
    df_r1['month'] = pd.to_datetime(df_r1['timestamp']).dt.to_period('M')
    df_r2['month'] = pd.to_datetime(df_r2['timestamp']).dt.to_period('M')
    
    pnl1_m = df_r1.groupby('month')['r'].sum()
    pnl2_m = df_r2.groupby('month')['r'].sum()
    
    df_ev = df[ev].copy()
    df_ev['month'] = df_ev['timestamp'].dt.to_period('M')
    all_months = sorted(df_ev['month'].unique())
    
    m_records = []
    for m in all_months:
        r1 = pnl1_m.get(m, 0.0)
        r2 = pnl2_m.get(m, 0.0)
        m_sub = df_ev[df_ev['month'] == m]
        m_ret = (m_sub['close'].iloc[-1] / m_sub['close'].iloc[0] - 1) * 100
        m_vol = m_sub['close'].pct_change().std() * np.sqrt(1440) * 100
        m_records.append({
            'dataset': dataset_name,
            'month': str(m),
            'r1_pnl': r1,
            'r2_pnl': r2,
            'r1_neg': r1 < 0,
            'r2_neg': r2 < 0,
            'both_neg': (r1 < 0 and r2 < 0),
            'either_neg': (r1 < 0 or r2 < 0),
            'mkt_ret': m_ret,
            'mkt_vol': m_vol
        })
    return pd.DataFrame(m_records)

def main():
    print("Loading Train data (2021H1~2023H1)...")
    df_train = C.load_data()
    res_train = run_dataset_monthly(df_train, "2021-01-04 00:00:00", "Train (선물 2.5년)")
    
    print("\nLoading Spot data (2018~2020)...")
    spot_dir = "E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_spot/klines/symbol=BTCUSDT/interval=1m"
    files_spot = [f for f in sorted(glob.glob(f"{spot_dir}/*.parquet")) if "2018-01" <= f[-15:-8] <= "2020-12"]
    df_spot = pd.concat([pd.read_parquet(f) for f in files_spot], ignore_index=True)
    res_spot = run_dataset_monthly(df_spot, "2018-01-04 00:00:00", "Spot (현물 3.0년)")
    
    res_all = pd.concat([res_train, res_spot], ignore_index=True)
    res_all.sort_values("month", inplace=True)
    res_all.reset_index(drop=True, inplace=True)
    
    for df_sub, name in [(res_train, "1. Train 기간 (2021-01 ~ 2023-06, 총 30개월)"), (res_all, "2. 5.5년 통산 (2018-01 ~ 2023-06, 총 66개월)")]:
        n = len(df_sub)
        r1_neg_cnt = df_sub['r1_neg'].sum()
        r2_neg_cnt = df_sub['r2_neg'].sum()
        both_neg_cnt = df_sub['both_neg'].sum()
        either_neg_cnt = df_sub['either_neg'].sum()
        
        print("=" * 85)
        print(f" {name}")
        print("=" * 85)
        print(f" 전체 개월 수: {n}개월")
        print(f" - 1위 (`1D: R`) 적자 개월 수:     {r1_neg_cnt}개월 ({r1_neg_cnt/n*100:4.1f}%) | 승률={100 - r1_neg_cnt/n*100:4.1f}%")
        print(f" - 2위 (`2D: R+RV`) 적자 개월 수:   {r2_neg_cnt}개월 ({r2_neg_cnt/n*100:4.1f}%) | 승률={100 - r2_neg_cnt/n*100:4.1f}%")
        print(f" - ★ [둘 다 동시 적자] 개월 수:    {both_neg_cnt}개월 ({both_neg_cnt/n*100:4.1f}%)")
        print(f" - [어느 한쪽이라도 적자] 개월 수: {either_neg_cnt}개월 ({either_neg_cnt/n*100:4.1f}%)")
        
        # Monthly returns statistics
        print("\n [월별 수익률 통계]")
        print(f" - 1위: 평균=+{df_sub['r1_pnl'].mean():.2f}%, 중앙값=+{df_sub['r1_pnl'].median():.2f}%, 최악월={df_sub['r1_pnl'].min():.2f}%, 최고월=+{df_sub['r1_pnl'].max():.2f}%")
        print(f" - 2위: 평균=+{df_sub['r2_pnl'].mean():.2f}%, 중앙값=+{df_sub['r2_pnl'].median():.2f}%, 최악월={df_sub['r2_pnl'].min():.2f}%, 최고월=+{df_sub['r2_pnl'].max():.2f}%")
        
        # Consecutive negative months
        def max_consecutive_neg(series):
            max_c = curr = 0
            for v in series:
                if v: curr += 1; max_c = max(max_c, curr)
                else: curr = 0
            return max_c
            
        print(f"\n [최대 연속 적자 개월 수]")
        print(f" - 1위 최대 연속 적자: {max_consecutive_neg(df_sub['r1_neg'])}개월")
        print(f" - 2위 최대 연속 적자: {max_consecutive_neg(df_sub['r2_neg'])}개월")
        print(f" - 둘 다 동시 연속 적자: {max_consecutive_neg(df_sub['both_neg'])}개월")
        
        print("\n [동시 적자(Both Negative)가 발생했던 구체적인 달 목록]")
        sub_both = df_sub[df_sub['both_neg']][['month', 'r1_pnl', 'r2_pnl', 'mkt_vol', 'mkt_ret']]
        print(sub_both.to_string(index=False))
        
        # Volatility comparison of both negative vs other months
        both_vol = df_sub[df_sub['both_neg']]['mkt_vol'].mean()
        other_vol = df_sub[~df_sub['both_neg']]['mkt_vol'].mean()
        print(f"\n -> 동시 적자 발생 월의 평균 시장 변동성: {both_vol:.3f}% vs 비적자 월 평균: {other_vol:.3f}%")
        print("=" * 85 + "\n")

if __name__ == '__main__':
    main()
