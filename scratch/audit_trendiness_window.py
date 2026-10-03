# -*- coding: utf-8 -*-
"""
audit_trendiness_window.py
Investigate the window mismatch issue:
Test whether the relationship between Trendiness and Fork 9 performance depends on
the lookback window size (15m, 60m, 4h, 12h, 24h) or trade-level DER.
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

def compute_er(c, win):
    diff_abs = np.abs(np.diff(c, prepend=c[0]))
    path = pd.Series(diff_abs).rolling(win).sum().values
    disp = np.abs(c - np.roll(c, win))
    return np.where(path > 0, disp / path, 0.0)

def main():
    print("Loading Train 2.5y dataset...")
    df = C.load_data()
    ev = C.eval_mask(df); zU, zL = C.band(df); z_ret, z_vol, lr = C.zscores(df)
    defs = C.all_node_defs(df, ev, zU, zL, z_ret, z_vol, lr)
    c = df.close.values
    timestamps = df.timestamp.values
    halves = (df.timestamp.dt.year.astype(str) + "H" + ((df.timestamp.dt.month - 1) // 6 + 1).astype(str)).values
    gt, gd = defs['G']
    node_dict = dict(zip(gt, gd))
    
    # Precompute ER for various windows: 15m, 60m (1h), 240m (4h), 720m (12h), 1440m (24h)
    print("Computing ER for multiple windows (15m, 60m, 240m, 720m, 1440m)...")
    er_15m = compute_er(c, 15)
    er_60m = compute_er(c, 60)
    er_4h  = compute_er(c, 240)
    er_12h = compute_er(c, 720)
    er_24h = compute_er(c, 1440)
    
    # 24h Realized Volatility
    lr_s = pd.Series(np.r_[0, np.diff(np.log(c))])
    vol_24h = lr_s.rolling(1440).std().values * np.sqrt(1440) * 100.0
    
    print("Running Fork 9 Rank 1 & Rank 2 simulations...")
    df_r1 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=None)
    df_r2 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=48.4)
    
    windows = [
        ("15분 (15m)", er_15m),
        ("1시간 (60m)", er_60m),
        ("4시간 (240m)", er_4h),
        ("12시간 (720m)", er_12h),
        ("24시간 (1440m)", er_24h)
    ]
    
    print("\n" + "=" * 100)
    print(" [검증 1] 추세성 관측 윈도우 크기별 PnL 상관관계 비교 (Train 2.5y, N=787 거래)")
    print("=" * 100)
    
    for dt, s_name in [(df_r1, "포크 9 1위 (1D: R)"), (df_r2, "포크 9 2위 (2D: R+RV)")]:
        print(f"\n>>> {s_name} <<<")
        t_indices = dt['t'].values
        y = dt['r'].values
        v_trades = vol_24h[t_indices]
        
        # Vol correlation
        r_vol, p_vol = stats.pearsonr(v_trades, y)
        print(f" - [변동성 축] 24h Volatility 상관계수: r = {r_vol:+.4f} (p-value = {p_vol:.4e})")
        print(" - [추세성 축] 윈도우별 ER 상관계수:")
        
        for w_name, er_arr in windows:
            er_vals = er_arr[t_indices]
            r_er, p_er = stats.pearsonr(er_vals, y)
            rho_er, p_rho = stats.spearmanr(er_vals, y)
            
            # Regression: y ~ 1 + vol + er
            X = np.column_stack([np.ones(len(y)), v_trades, er_vals])
            beta, _, _, _ = np.linalg.lstsq(X, y, rcond=None)
            df_e = len(y) - 3
            sigma2 = np.sum((y - X @ beta)**2) / df_e
            se = np.sqrt(np.diag(np.linalg.inv(X.T @ X) * sigma2))
            t_er = beta[2] / se[2]
            p_reg = 2 * (1 - stats.t.cdf(abs(t_er), df=df_e))
            
            # Split High ER vs Low ER PnL
            med_er = np.median(er_vals)
            pnl_high = y[er_vals >= med_er].sum()
            pnl_low = y[er_vals < med_er].sum()
            
            print(f"   * {w_name:<14}: Pearson r={r_er:+.4f} (p={p_er:.3e}) | 회귀 t-stat={t_er:+5.2f} (p={p_reg:.3e}) | 고추세 손익={pnl_high:+6.1f}%, 저추세 손익={pnl_low:+6.1f}% (격차: {pnl_high - pnl_low:+6.1f}%p)")

    # -------------------------------------------------------------
    # Test on 2026 dataset
    # -------------------------------------------------------------
    print("\n" + "=" * 100)
    print(" [검증 2] 2026년 데이터에서 윈도우별 추세성 검증 (2026 YTD, N=245 거래)")
    print("=" * 100)
    files_2026 = sorted(glob.glob('E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_um/klines/symbol=BTCUSDT/interval=1m/2026-*.parquet'))
    dfs = [pd.read_parquet(f) for f in files_2026]
    dfs.append(pd.read_parquet('e:/Devs/agTest/cats/scratch/recent_35d_btc_1m.parquet'))
    df_26 = pd.concat(dfs, ignore_index=True)
    df_26.drop_duplicates(subset=['timestamp'], inplace=True)
    df_26.sort_values('timestamp', inplace=True)
    df_26.reset_index(drop=True, inplace=True)
    
    c_26 = df_26.close.values
    ts_26 = df_26.timestamp.values
    halves_26 = ['2026H1' if str(t) < '2026-07-01' else '2026H2' for t in ts_26]
    
    ev_26 = df_26.index >= 1440
    zU_26, zL_26 = C.band(df_26); z_ret_26, z_vol_26, lr_26 = C.zscores(df_26)
    defs_26 = C.all_node_defs(df_26, ev_26, zU_26, zL_26, z_ret_26, z_vol_26, lr_26)
    gt26, gd26 = defs_26['G']
    node_dict_26 = dict(zip(gt26, gd26))
    
    df_r1_26 = run_detailed_sim(c_26, ts_26, halves_26, node_dict_26, [10, 60], r_cut=-0.41, rv_cut=None)
    df_r1_26 = df_r1_26[df_r1_26['timestamp'] >= '2026-01-02'].copy()
    
    er_15m_26 = compute_er(c_26, 15)
    er_60m_26 = compute_er(c_26, 60)
    er_4h_26  = compute_er(c_26, 240)
    er_24h_26 = compute_er(c_26, 1440)
    
    y_26 = df_r1_26['r'].values
    t_26 = df_r1_26['t'].values
    
    print("\n>>> 2026년 포크 9 1위: 윈도우별 ER과 손익의 관계 <<<")
    for w_name, er_arr in [("15분 (15m)", er_15m_26), ("1시간 (60m)", er_60m_26), ("4시간 (240m)", er_4h_26), ("24시간 (24h)", er_24h_26)]:
        er_vals = er_arr[t_26]
        r_er, p_er = stats.pearsonr(er_vals, y_26)
        med_er = np.median(er_vals)
        pnl_high = y_26[er_vals >= med_er].sum()
        pnl_low = y_26[er_vals < med_er].sum()
        print(f" * {w_name:<14}: Pearson r={r_er:+.4f} (p={p_er:.3e}) | 고추세 손익={pnl_high:+6.1f}%, 저추세 손익={pnl_low:+6.1f}% (격차: {pnl_high - pnl_low:+6.1f}%p)")

if __name__ == '__main__':
    main()
