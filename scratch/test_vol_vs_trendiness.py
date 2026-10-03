# -*- coding: utf-8 -*-
"""
test_vol_vs_trendiness.py
Deconstruct whether Fork 7 and Fork 9 strategies are truly weak against Volatility,
Trendiness (Directional Efficiency ER), or their interaction.
"""

import sys, os, glob
sys.path.insert(0, r'e:\Devs\agTest\cats\scratch')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9\src')
import common as C
import pandas as pd
import numpy as np
from scipy import stats
from test_vol_significance import run_detailed_sim
from test_fork7_recent_month import run_fork7_simulation

def compute_regime_features(df):
    c = df['close'].values
    n = len(c)
    
    # 1. 24h Realized Volatility
    lr = np.r_[0, np.diff(np.log(c))]
    vol_24h = pd.Series(lr).rolling(1440).std().values * np.sqrt(1440) * 100.0
    
    # 2. 24h Kaufman Efficiency Ratio (ER24h)
    diff_abs = np.abs(np.diff(c, prepend=c[0]))
    path24 = pd.Series(diff_abs).rolling(1440).sum().values
    disp24 = np.abs(c - np.roll(c, 1440))
    er24 = np.where(path24 > 0, disp24 / path24, 0.0)
    
    return vol_24h, er24

def analyze_dataset_2d(dataset_name, df, df_r1, df_r2, df_f7, vol_24h, er24):
    print("=" * 95)
    print(f" 2D MATRIX ANALYSIS: VOLATILITY VS TRENDINESS ({dataset_name})")
    print("=" * 95)
    
    # Median cuts over valid bars
    valid_mask = ~np.isnan(vol_24h) & (np.arange(len(df)) >= 1440)
    med_vol = np.median(vol_24h[valid_mask])
    med_er = np.median(er24[valid_mask])
    
    print(f" 기준선 (중앙값): 24h 변동성 P50 = {med_vol:.3f}%, 24h 추세성(ER) P50 = {med_er:.3f}")
    
    # Tag trades with entry regime
    for dt, s_name in [(df_r1, "포크 9 1위 (1D: R)"), (df_r2, "포크 9 2위 (2D: R+RV)"), (df_f7, "포크 7 (Cand 3-EG)")]:
        if len(dt) == 0:
            continue
        t_indices = dt['t'].values if 't' in dt.columns else dt['entry_t'].values
        dt['vol'] = [vol_24h[idx] for idx in t_indices]
        dt['er'] = [er24[idx] for idx in t_indices]
        
        dt['is_high_vol'] = dt['vol'] >= med_vol
        dt['is_high_er'] = dt['er'] >= med_er
        
        def assign_quadrant(row):
            if row['is_high_vol'] and row['is_high_er']:
                return "1. 고변동 + 고추세 (Strong Trend Rally)"
            elif row['is_high_vol'] and not row['is_high_er']:
                return "2. 고변동 + 저추세 (Violent Choppy Chop)"
            elif not row['is_high_vol'] and row['is_high_er']:
                return "3. 저변동 + 고추세 (Quiet Smooth Drift)"
            else:
                return "4. 저변동 + 저추세 (Flatline Dead Crab)"
                
        dt['quadrant'] = dt.apply(assign_quadrant, axis=1)
        
        # 4 Quadrant Performance Table
        quad_order = [
            "1. 고변동 + 고추세 (Strong Trend Rally)",
            "2. 고변동 + 저추세 (Violent Choppy Chop)",
            "3. 저변동 + 고추세 (Quiet Smooth Drift)",
            "4. 저변동 + 저추세 (Flatline Dead Crab)"
        ]
        
        q_stats = []
        for q in quad_order:
            sub = dt[dt['quadrant'] == q]
            cnt = len(sub)
            if cnt == 0:
                q_stats.append({
                    '국면 (Quadrant)': q, '거래수': 0, '비중': '0.0%',
                    '누적손익': 0.0, '평균손익': 0.0, '승률': '0.0%'
                })
                continue
            r_sum = sub['r'].sum()
            r_mean = sub['r'].mean()
            wr = (sub['r'] > 0).mean() * 100.0
            q_stats.append({
                '국면 (Quadrant)': q, '거래수': cnt,
                '비중': f"{cnt/len(dt)*100:4.1f}%",
                '누적손익': f"{r_sum:+6.1f}%",
                '평균손익': f"{r_mean:+5.2f}%",
                '승률': f"{wr:4.1f}%"
            })
            
        print(f"\n>>> {s_name} (총 {len(dt)}회 거래) <<<")
        print(pd.DataFrame(q_stats).to_string(index=False))
        
        # Marginal analysis: Volatility only vs Trendiness only
        vol_high_r = dt[dt['is_high_vol']]['r'].sum()
        vol_low_r = dt[~dt['is_high_vol']]['r'].sum()
        er_high_r = dt[dt['is_high_er']]['r'].sum()
        er_low_r = dt[~dt['is_high_er']]['r'].sum()
        
        print("\n [단일 요인별 한계 손익 비교]")
        print(f" - 변동성 기준: 고변동 손익 = {vol_high_r:+6.1f}% vs 저변동 손익 = {vol_low_r:+6.1f}% (격차: {vol_high_r - vol_low_r:+6.1f}%p)")
        print(f" - 추세성 기준: 고추세 손익 = {er_high_r:+6.1f}% vs 저추세 손익 = {er_low_r:+6.1f}% (격차: {er_high_r - er_low_r:+6.1f}%p)")
        
        # OLS Multiple Regression: r ~ 1 + vol + er using numpy
        X = np.column_stack([np.ones(len(dt)), dt['vol'].values, dt['er'].values])
        y = dt['r'].values
        beta, residuals, rank, s = np.linalg.lstsq(X, y, rcond=None)
        n_obs = len(y)
        p_vars = X.shape[1]
        df_e = n_obs - p_vars
        sigma2 = np.sum((y - X @ beta) ** 2) / df_e
        cov_beta = np.linalg.inv(X.T @ X) * sigma2
        se_beta = np.sqrt(np.diag(cov_beta))
        t_vals = beta / se_beta
        p_vals = 2 * (1 - stats.t.cdf(np.abs(t_vals), df=df_e))
        
        print(f"\n [다중 회귀 분석 (OLS Regression): PnL ~ Volatility + Trendiness(ER)]")
        print(f" - 절편 (const):   coef={beta[0]:+6.3f} (t={t_vals[0]:+5.2f}, p-value={p_vals[0]:.4e})")
        print(f" - 변동성 (Vol):   coef={beta[1]:+6.3f} (t={t_vals[1]:+5.2f}, p-value={p_vals[1]:.4e})")
        print(f" - 추세성 (ER):    coef={beta[2]:+6.3f} (t={t_vals[2]:+5.2f}, p-value={p_vals[2]:.4e})")
        
        # 4 Quadrants One-way ANOVA
        groups = [dt[dt['quadrant'] == q]['r'].values for q in quad_order if len(dt[dt['quadrant'] == q]) > 0]
        f_stat, p_f = stats.f_oneway(*groups)
        print(f"\n [4개 국면 간 수익률 차이 분산분석 (ANOVA)]")
        print(f" - F-통계량: {f_stat:.4f}, p-value: {p_f:.4e}")

def main():
    # 1. Train 2.5y
    print("Loading Train 2.5y dataset...")
    df_train = C.load_data()
    ev = C.eval_mask(df_train); zU, zL = C.band(df_train); z_ret, z_vol, lr = C.zscores(df_train)
    defs = C.all_node_defs(df_train, ev, zU, zL, z_ret, z_vol, lr)
    c_tr = df_train.close.values
    ts_tr = df_train.timestamp.values
    halves_tr = (df_train.timestamp.dt.year.astype(str) + "H" + ((df_train.timestamp.dt.month - 1) // 6 + 1).astype(str)).values
    gt, gd = defs['G']
    node_dict_tr = dict(zip(gt, gd))
    
    vol_tr, er_tr = compute_regime_features(df_train)
    
    df_r1_tr = run_detailed_sim(c_tr, ts_tr, halves_tr, node_dict_tr, [10, 60], r_cut=-0.41, rv_cut=None)
    df_r2_tr = run_detailed_sim(c_tr, ts_tr, halves_tr, node_dict_tr, [10, 60], r_cut=-0.41, rv_cut=48.4)
    df_f7_tr = run_fork7_simulation(df_train)
    
    analyze_dataset_2d("선물 Train (2021H1 ~ 2023H1, 2.5년)", df_train, df_r1_tr, df_r2_tr, df_f7_tr, vol_tr, er_tr)
    
    # 2. 2026 Year-to-date
    print("\nLoading 2026 dataset...")
    files_2026 = sorted(glob.glob('E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_um/klines/symbol=BTCUSDT/interval=1m/2026-*.parquet'))
    dfs = [pd.read_parquet(f) for f in files_2026]
    dfs.append(pd.read_parquet('e:/Devs/agTest/cats/scratch/recent_35d_btc_1m.parquet'))
    df_2026 = pd.concat(dfs, ignore_index=True)
    df_2026.drop_duplicates(subset=['timestamp'], inplace=True)
    df_2026.sort_values('timestamp', inplace=True)
    df_2026.reset_index(drop=True, inplace=True)
    
    ev_26 = df_2026.index >= 1440
    zU_26, zL_26 = C.band(df_2026); z_ret_26, z_vol_26, lr_26 = C.zscores(df_2026)
    defs_26 = C.all_node_defs(df_2026, ev_26, zU_26, zL_26, z_ret_26, z_vol_26, lr_26)
    c_26 = df_2026.close.values
    ts_26 = df_2026.timestamp.values
    halves_26 = ['2026H1' if str(t) < '2026-07-01' else '2026H2' for t in ts_26]
    gt26, gd26 = defs_26['G']
    node_dict_26 = dict(zip(gt26, gd26))
    
    vol_26, er_26 = compute_regime_features(df_2026)
    
    df_r1_26 = run_detailed_sim(c_26, ts_26, halves_26, node_dict_26, [10, 60], r_cut=-0.41, rv_cut=None)
    df_r2_26 = run_detailed_sim(c_26, ts_26, halves_26, node_dict_26, [10, 60], r_cut=-0.41, rv_cut=48.4)
    df_f7_26 = run_fork7_simulation(df_2026)
    
    # Filter 2026-01-02 onwards
    df_r1_26 = df_r1_26[df_r1_26['timestamp'] >= '2026-01-02'].copy()
    df_r2_26 = df_r2_26[df_r2_26['timestamp'] >= '2026-01-02'].copy()
    df_f7_26 = df_f7_26[df_f7_26['entry_time'] >= '2026-01-02'].copy()
    
    analyze_dataset_2d("2026년 전체 (2026-01-02 ~ 2026-10-03 YTD)", df_2026, df_r1_26, df_r2_26, df_f7_26, vol_26, er_26)

if __name__ == '__main__':
    main()
