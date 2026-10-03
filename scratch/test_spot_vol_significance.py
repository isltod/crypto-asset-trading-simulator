# -*- coding: utf-8 -*-
"""
test_spot_vol_significance.py
Verify if the low-volatility flip suppression holds in Spot (2018-2020, 3y).
"""
import sys, os, glob
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9\src')
import common as C
import numpy as np
import pandas as pd
from scipy import stats
from test_vol_significance import run_detailed_sim

def main():
    spot_dir = "E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_spot/klines/symbol=BTCUSDT/interval=1m"
    files_spot = [f for f in sorted(glob.glob(f"{spot_dir}/*.parquet")) if "2018-01" <= f[-15:-8] <= "2020-12"]
    print(f"Loading Spot 2018~2020 data ({len(files_spot)} files)...")
    df = pd.concat([pd.read_parquet(f) for f in files_spot], ignore_index=True)
    df.sort_values("timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)
    
    # Filter 2018-01-04 onwards to allow warm up
    ev = (df["timestamp"] >= "2018-01-04 00:00:00").values
    zU, zL = C.band(df)
    z_ret, z_vol, lr = C.zscores(df)
    defs = C.all_node_defs(df, ev, zU, zL, z_ret, z_vol, lr)
    
    c = df.close.values
    timestamps = df.timestamp.values
    halves = (df.timestamp.dt.year.astype(str) + "H" + ((df.timestamp.dt.month - 1) // 6 + 1).astype(str)).values
    
    gt, gd = defs['G']
    node_dict = dict(zip(gt, gd))
    
    log_ret_series = pd.Series(np.r_[0, np.diff(np.log(c))])
    vol_24h = log_ret_series.rolling(1440).std().values * np.sqrt(1440) * 100.0
    
    print("Running Spot Rank 1 & Rank 2 simulations...")
    df_r1 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=None)
    df_r2 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=48.4)
    
    flips_r1 = df_r1[df_r1["type"] == "flip"].copy()
    flips_r2 = df_r2[df_r2["type"] == "flip"].copy()
    
    flips_r1["vol_24h"] = [vol_24h[t] for t in flips_r1["t"]]
    flips_r2["vol_24h"] = [vol_24h[t] for t in flips_r2["t"]]
    
    print(f"Spot Rank 1: Total Trades = {len(df_r1)}, Flips = {len(flips_r1)}")
    print(f"Spot Rank 2: Total Trades = {len(df_r2)}, Flips = {len(flips_r2)}")
    
    eval_indices = np.where(ev)[0]
    valid_vol_24h = vol_24h[eval_indices]
    valid_vol_24h = valid_vol_24h[~np.isnan(valid_vol_24h)]
    q50 = np.quantile(valid_vol_24h, 0.50)
    q33 = np.quantile(valid_vol_24h, 1/3)
    q67 = np.quantile(valid_vol_24h, 2/3)
    
    flips_r1["is_low_50"] = flips_r1["vol_24h"] < q50
    flips_r2["is_low_50"] = flips_r2["vol_24h"] < q50
    
    r1_low = len(flips_r1[flips_r1["is_low_50"]])
    r1_high = len(flips_r1[~flips_r1["is_low_50"]])
    r2_low = len(flips_r2[flips_r2["is_low_50"]])
    r2_high = len(flips_r2[~flips_r2["is_low_50"]])
    
    print("\n" + "=" * 90)
    print(" SPOT (2018-2020) CONTINGENCY TABLE & TESTS")
    print("=" * 90)
    print(f"                  | Low Vol (<P50) | High Vol (>=P50) | Total Flips")
    print(f" Rank 1 (1D: R)   | {r1_low:14d} | {r1_high:16d} | {len(flips_r1):11d}")
    print(f" Rank 2 (2D: R+RV)| {r2_low:14d} | {r2_high:16d} | {len(flips_r2):11d}")
    print(f" Difference       | {r1_low - r2_low:+14d} | {r1_high - r2_high:+16d} | {len(flips_r1) - len(flips_r2):+11d}")
    
    contingency_2x2 = np.array([[r1_low, r1_high], [r2_low, r2_high]])
    chi2, p_val_chi2, _, _ = stats.chi2_contingency(contingency_2x2, correction=True)
    odds_ratio, p_val_fisher = stats.fisher_exact(contingency_2x2, alternative='greater')
    print(f"Chi-square p-value: {p_val_chi2:.4e}, Fisher p-value: {p_val_fisher:.4e}, Odds Ratio: {odds_ratio:.4f}")

if __name__ == '__main__':
    main()
