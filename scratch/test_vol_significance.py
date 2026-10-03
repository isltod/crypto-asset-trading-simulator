# -*- coding: utf-8 -*-
"""
test_vol_significance.py
Test whether Rank 1 executes significantly more trades and flips than Rank 2
specifically in low-volatility market regimes, and evaluate statistical significance.
"""

import sys, os
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9')
sys.path.insert(0, r'e:\Devs\extreme_breakout_fork9\src')
import common as C
import numpy as np
import pandas as pd
from scipy import stats

def run_detailed_sim(c, timestamps, halves, node_dict, check_points, r_cut=None, rv_cut=None, der_cut=None):
    n_bars = len(c)
    pos = 0.0
    orig_dir = 0.0
    is_flipped = False
    entry_p = 0.0
    inspect_ref_p = 0.0
    base_event_t = -1
    inspect_base_t = -1
    trades = []
    
    check_set = set(check_points)
    max_check = max(check_points)
    
    for t in range(n_bars):
        has_node = t in node_dict
        curr_p = c[t]
        
        # 1. Checkpoint evaluation
        if base_event_t != -1 and pos != 0.0:
            elapsed = t - base_event_t
            if not is_flipped and elapsed in check_set:
                sc = c[base_event_t : t + 1]
                r_val = pos * (curr_p - entry_p) / entry_p * 100.0
                diffs = np.diff(sc)
                path = np.sum(np.abs(diffs))
                der_val = (pos * (sc[-1] - sc[0])) / (path if path > 0 else 1e-6)
                log_ret = np.diff(np.log(sc))
                rv_val = np.sqrt(np.sum(log_ret**2)) * 10000.0
                
                cond = True
                if r_cut is not None:
                    cond = cond and (r_val <= r_cut)
                if rv_cut is not None:
                    cond = cond and (rv_val >= rv_cut)
                if der_cut is not None:
                    cond = cond and (der_val <= der_cut)
                    
                if cond:
                    r_trade = pos * (curr_p - entry_p) / entry_p * 100.0
                    trades.append({
                        "t": t, "timestamp": timestamps[t], "half": halves[t],
                        "type": "flip", "r": r_trade, "r_val": r_val, "rv_val": rv_val,
                        "elapsed": elapsed
                    })
                    pos = -pos
                    entry_p = curr_p
                    is_flipped = True
                    base_event_t = -1
                elif elapsed == max_check:
                    base_event_t = -1
            elif is_flipped and elapsed in check_set:
                sc_g = c[inspect_base_t : t + 1]
                diffs_g = np.diff(sc_g)
                path_g = np.sum(np.abs(diffs_g))
                der_g = (pos * (sc_g[-1] - sc_g[0])) / (path_g if path_g > 0 else 1e-6)
                log_ret_g = np.diff(np.log(sc_g))
                rv_g = np.sqrt(np.sum(log_ret_g**2)) * 10000.0
                r_inspect = pos * (curr_p - inspect_ref_p) / inspect_ref_p * 100.0
                
                guard_cond = True
                if r_cut is not None:
                    guard_cond = guard_cond and (r_inspect <= r_cut)
                if rv_cut is not None:
                    guard_cond = guard_cond and (rv_g >= rv_cut)
                if der_cut is not None:
                    guard_cond = guard_cond and (der_g <= der_cut)
                    
                if guard_cond:
                    r_trade = pos * (curr_p - entry_p) / entry_p * 100.0
                    trades.append({
                        "t": t, "timestamp": timestamps[t], "half": halves[t],
                        "type": "guard_exit", "r": r_trade, "r_val": r_inspect, "rv_val": rv_g,
                        "elapsed": elapsed
                    })
                    pos = 0.0
                    entry_p = 0.0
                    base_event_t = -1
                    is_flipped = False
                elif elapsed == max_check:
                    base_event_t = -1
                    
        # 2. Node signal
        if has_node:
            nd = node_dict[t]
            if pos == 0.0:
                can_enter = True
                if orig_dir != 0.0 and nd != -orig_dir:
                    can_enter = False
                if can_enter:
                    pos = nd
                    orig_dir = nd
                    entry_p = curr_p
                    is_flipped = False
                    base_event_t = t
            elif not is_flipped:
                if nd == pos:
                    base_event_t = t
                else:
                    r_trade = pos * (curr_p - entry_p) / entry_p * 100.0
                    trades.append({
                        "t": t, "timestamp": timestamps[t], "half": halves[t],
                        "type": "sar", "r": r_trade, "r_val": 0.0, "rv_val": 0.0, "elapsed": 0
                    })
                    pos = nd
                    orig_dir = nd
                    entry_p = curr_p
                    is_flipped = False
                    base_event_t = t
            else:
                if nd == orig_dir:
                    base_event_t = t
                    inspect_ref_p = curr_p
                    inspect_base_t = t
                else:
                    is_flipped = False
                    orig_dir = nd
                    base_event_t = t
                    
    if pos != 0.0:
        trades.append({
            "t": n_bars - 1, "timestamp": timestamps[-1], "half": halves[-1],
            "type": "end", "r": pos * (c[-1] - entry_p) / entry_p * 100.0,
            "r_val": 0.0, "rv_val": 0.0, "elapsed": 0
        })
        
    df_t = pd.DataFrame(trades)
    return df_t

def main():
    print("Loading Train data (2021H1~2023H1)...")
    df = C.load_data()
    ev = C.eval_mask(df); zU, zL = C.band(df); z_ret, z_vol, lr = C.zscores(df)
    defs = C.all_node_defs(df, ev, zU, zL, z_ret, z_vol, lr)
    c = df.close.values
    timestamps = df.timestamp.values
    halves = (df.timestamp.dt.year.astype(str) + "H" + ((df.timestamp.dt.month - 1) // 6 + 1).astype(str)).values
    
    gt, gd = defs['G']
    node_dict = dict(zip(gt, gd))
    
    # Calculate market rolling volatilities
    print("Computing market rolling volatility series...")
    log_ret_series = pd.Series(np.r_[0, np.diff(np.log(c))])
    vol_24h = log_ret_series.rolling(1440).std().values * np.sqrt(1440) * 100.0 # Daily std %
    vol_6h = log_ret_series.rolling(360).std().values * np.sqrt(360) * 100.0
    vol_12h = log_ret_series.rolling(720).std().values * np.sqrt(720) * 100.0
    
    # Run simulations
    print("Running Rank 1 simulation...")
    df_r1 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=None)
    print("Running Rank 2 simulation...")
    df_r2 = run_detailed_sim(c, timestamps, halves, node_dict, [10, 60], r_cut=-0.41, rv_cut=48.4)
    
    # Map market volatility to trades
    for df_curr in [df_r1, df_r2]:
        df_curr["vol_24h"] = [vol_24h[t] for t in df_curr["t"]]
        df_curr["vol_12h"] = [vol_12h[t] for t in df_curr["t"]]
        df_curr["vol_6h"] = [vol_6h[t] for t in df_curr["t"]]
        df_curr["month"] = pd.to_datetime(df_curr["timestamp"]).dt.to_period("M")
        
    print(f"\nRank 1: Total Trades = {len(df_r1)}, Flips = {len(df_r1[df_r1['type']=='flip'])}")
    print(f"Rank 2: Total Trades = {len(df_r2)}, Flips = {len(df_r2[df_r2['type']=='flip'])}")
    
    flips_r1 = df_r1[df_r1["type"] == "flip"].copy()
    flips_r2 = df_r2[df_r2["type"] == "flip"].copy()
    
    # Determine market volatility quantile thresholds over the entire evaluation period
    eval_indices = np.where(ev)[0]
    valid_vol_24h = vol_24h[eval_indices]
    valid_vol_24h = valid_vol_24h[~np.isnan(valid_vol_24h)]
    
    q33 = np.quantile(valid_vol_24h, 1/3)
    q50 = np.quantile(valid_vol_24h, 0.50)
    q67 = np.quantile(valid_vol_24h, 2/3)
    q25 = np.quantile(valid_vol_24h, 0.25)
    q75 = np.quantile(valid_vol_24h, 0.75)
    
    print("\n" + "=" * 90)
    print(f" MARKET VOLATILITY DISTRIBUTION (24h Daily Vol %)")
    print(f"  Q25: {q25:.3f}%, Q33: {q33:.3f}%, Median (Q50): {q50:.3f}%, Q67: {q67:.3f}%, Q75: {q75:.3f}%")
    print("=" * 90)
    
    # -------------------------------------------------------------
    # Analysis 1: Terciles (Low, Mid, High)
    # -------------------------------------------------------------
    def assign_tercile(v):
        if v < q33: return "Low Vol (<33%)"
        elif v < q67: return "Mid Vol (33-67%)"
        else: return "High Vol (>67%)"
        
    flips_r1["regime_3"] = flips_r1["vol_24h"].apply(assign_tercile)
    flips_r2["regime_3"] = flips_r2["vol_24h"].apply(assign_tercile)
    df_r1["regime_3"] = df_r1["vol_24h"].apply(assign_tercile)
    df_r2["regime_3"] = df_r2["vol_24h"].apply(assign_tercile)
    
    reg_order = ["Low Vol (<33%)", "Mid Vol (33-67%)", "High Vol (>67%)"]
    
    print("\n[1] FLIP COUNT COMPARISON BY VOLATILITY TERCILE (24h Vol):")
    flip_tab = []
    for reg in reg_order:
        c1 = len(flips_r1[flips_r1["regime_3"] == reg])
        c2 = len(flips_r2[flips_r2["regime_3"] == reg])
        diff = c1 - c2
        pct_diff = (diff / c2 * 100) if c2 > 0 else 0
        prop_1 = c1 / len(flips_r1) * 100
        prop_2 = c2 / len(flips_r2) * 100
        flip_tab.append({
            "Regime": reg, "Rank 1 Flips": c1, "Rank 1 %": f"{prop_1:.1f}%",
            "Rank 2 Flips": c2, "Rank 2 %": f"{prop_2:.1f}%",
            "Diff (R1 - R2)": diff, "R1 Excess %": f"+{pct_diff:.1f}%"
        })
    df_flip_tab = pd.DataFrame(flip_tab)
    print(df_flip_tab.to_string(index=False))
    
    print("\n[2] TOTAL TRADE COUNT COMPARISON BY VOLATILITY TERCILE (24h Vol):")
    trade_tab = []
    for reg in reg_order:
        t1 = len(df_r1[df_r1["regime_3"] == reg])
        t2 = len(df_r2[df_r2["regime_3"] == reg])
        diff = t1 - t2
        trade_tab.append({
            "Regime": reg, "Rank 1 Trades": t1, "Rank 2 Trades": t2,
            "Diff (R1 - R2)": diff
        })
    df_trade_tab = pd.DataFrame(trade_tab)
    print(df_trade_tab.to_string(index=False))
    
    # -------------------------------------------------------------
    # Analysis 2: Binary Median Split (Low Vol < 50% vs High Vol >= 50%)
    # -------------------------------------------------------------
    flips_r1["is_low_50"] = flips_r1["vol_24h"] < q50
    flips_r2["is_low_50"] = flips_r2["vol_24h"] < q50
    
    r1_low = len(flips_r1[flips_r1["is_low_50"]])
    r1_high = len(flips_r1[~flips_r1["is_low_50"]])
    r2_low = len(flips_r2[flips_r2["is_low_50"]])
    r2_high = len(flips_r2[~flips_r2["is_low_50"]])
    
    print("\n" + "=" * 90)
    print(" CONTINGENCY TABLE & STATISTICAL SIGNIFICANCE TESTS (Median Split: Low Vol vs High Vol)")
    print("=" * 90)
    print(f"                  | Low Vol (<P50) | High Vol (>=P50) | Total Flips")
    print(f" Rank 1 (1D: R)   | {r1_low:14d} | {r1_high:16d} | {len(flips_r1):11d}")
    print(f" Rank 2 (2D: R+RV)| {r2_low:14d} | {r2_high:16d} | {len(flips_r2):11d}")
    print(f" Difference       | {r1_low - r2_low:+14d} | {r1_high - r2_high:+16d} | {len(flips_r1) - len(flips_r2):+11d}")
    
    # Chi-Square Test
    contingency_2x2 = np.array([
        [r1_low, r1_high],
        [r2_low, r2_high]
    ])
    chi2, p_val_chi2, dof, ex = stats.chi2_contingency(contingency_2x2, correction=True)
    odds_ratio, p_val_fisher = stats.fisher_exact(contingency_2x2, alternative='greater')
    
    # Two-proportion z-test
    p1 = r1_low / len(flips_r1)
    p2 = r2_low / len(flips_r2)
    p_pool = (r1_low + r2_low) / (len(flips_r1) + len(flips_r2))
    se = np.sqrt(p_pool * (1 - p_pool) * (1/len(flips_r1) + 1/len(flips_r2)))
    z_stat = (p1 - p2) / se
    p_val_z_one = 1 - stats.norm.cdf(z_stat)
    p_val_z_two = 2 * (1 - stats.norm.cdf(abs(z_stat)))
    
    print("\n--- Statistical Test Results (Flips: Low vs High Vol) ---")
    print(f" Proportion of Flips in Low Vol: Rank 1 = {p1*100:.2f}% vs Rank 2 = {p2*100:.2f}% (Diff = {(p1-p2)*100:+.2f}%p)")
    print(f" 1) Chi-Square Test (with Yates correction):")
    print(f"    chi2 = {chi2:.4f}, dof = {dof}, p-value = {p_val_chi2:.4e}")
    print(f" 2) Fisher's Exact Test (Alternative: Rank 1 has higher odds of Low-Vol flips):")
    print(f"    Odds Ratio = {odds_ratio:.4f}, p-value = {p_val_fisher:.4e}")
    print(f" 3) Two-Proportion Z-Test:")
    print(f"    Z-score = {z_stat:.4f}, One-tailed p-value = {p_val_z_one:.4e}, Two-tailed p-value = {p_val_z_two:.4e}")
    
    # Also check Chi-Square for Terciles (2x3)
    contingency_2x3 = np.array([
        [len(flips_r1[flips_r1["regime_3"] == reg]) for reg in reg_order],
        [len(flips_r2[flips_r2["regime_3"] == reg]) for reg in reg_order]
    ])
    chi2_3, p_val_3, dof_3, _ = stats.chi2_contingency(contingency_2x3)
    print(f"\n 4) Chi-Square Test (Terciles: 2x3 Contingency):")
    print(f"    chi2 = {chi2_3:.4f}, dof = {dof_3}, p-value = {p_val_3:.4e}")
    
    # -------------------------------------------------------------
    # Analysis 3: Monthly Time-Series Paired Analysis (N = 30 months)
    # -------------------------------------------------------------
    print("\n" + "=" * 90)
    print(" MONTHLY TIME-SERIES CORRELATION & PAIRED ANALYSIS (N = 30 Months)")
    print("=" * 90)
    
    df["month"] = df["timestamp"].dt.to_period("M")
    monthly_vol = df.groupby("month").apply(lambda g: (g["close"].pct_change().std() * np.sqrt(1440) * 100.0)).to_dict()
    
    r1_monthly_flips = flips_r1.groupby("month").size().to_dict()
    r2_monthly_flips = flips_r2.groupby("month").size().to_dict()
    r1_monthly_trades = df_r1.groupby("month").size().to_dict()
    r2_monthly_trades = df_r2.groupby("month").size().to_dict()
    
    months = sorted(list(df["month"].unique()))
    m_records = []
    for m in months:
        v = monthly_vol.get(m, 0.0)
        f1 = r1_monthly_flips.get(m, 0)
        f2 = r2_monthly_flips.get(m, 0)
        t1 = r1_monthly_trades.get(m, 0)
        t2 = r2_monthly_trades.get(m, 0)
        m_records.append({
            "month": str(m), "vol": v,
            "f1": f1, "f2": f2, "f_diff": f1 - f2,
            "t1": t1, "t2": t2, "t_diff": t1 - t2
        })
    df_m = pd.DataFrame(m_records)
    
    # Correlation between monthly market volatility and flip difference
    corr_p_f, pval_p_f = stats.pearsonr(df_m["vol"], df_m["f_diff"])
    corr_s_f, pval_s_f = stats.spearmanr(df_m["vol"], df_m["f_diff"])
    
    corr_p_t, pval_p_t = stats.pearsonr(df_m["vol"], df_m["t_diff"])
    corr_s_t, pval_s_t = stats.spearmanr(df_m["vol"], df_m["t_diff"])
    
    print(f" Correlation between Market Volatility and Flip Difference (R1 - R2):")
    print(f"  - Pearson r  = {corr_p_f:+.4f} (p-value = {pval_p_f:.4e})")
    print(f"  - Spearman rho = {corr_s_f:+.4f} (p-value = {pval_s_f:.4e})")
    
    print(f"\n Correlation between Market Volatility and Trade Difference (R1 - R2):")
    print(f"  - Pearson r  = {corr_p_t:+.4f} (p-value = {pval_p_t:.4e})")
    print(f"  - Spearman rho = {corr_s_t:+.4f} (p-value = {pval_s_t:.4e})")
    
    # Monthly Low Vol vs High Vol comparison
    m_med_vol = df_m["vol"].median()
    low_m = df_m[df_m["vol"] < m_med_vol]
    high_m = df_m[df_m["vol"] >= m_med_vol]
    
    t_stat_f, p_ttest_f = stats.ttest_ind(low_m["f_diff"], high_m["f_diff"], equal_var=False)
    u_stat_f, p_mann_f = stats.mannwhitneyu(low_m["f_diff"], high_m["f_diff"], alternative='greater')
    
    print(f"\n Monthly Flip Difference by Volatility Regime:")
    print(f"  - Low-Vol Months (N={len(low_m)}):  Mean ΔFlip = {low_m['f_diff'].mean():+.2f} flips/month (Total Δ = {low_m['f_diff'].sum()})")
    print(f"  - High-Vol Months (N={len(high_m)}): Mean ΔFlip = {high_m['f_diff'].mean():+.2f} flips/month (Total Δ = {high_m['f_diff'].sum()})")
    print(f"  - Welch's t-test: t = {t_stat_f:.4f}, p-value = {p_ttest_f:.4e}")
    print(f"  - Mann-Whitney U test (Low > High): U = {u_stat_f}, p-value = {p_mann_f:.4e}")
    
    # -------------------------------------------------------------
    # Analysis 4: Micro-level Checkpoint Inspection RV Distribution
    # -------------------------------------------------------------
    print("\n" + "=" * 90)
    print(" MICRO-LEVEL CHECKPOINT REALIZED VOLATILITY (RV) ANALYSIS")
    print("=" * 90)
    print(f" Total checkpoints triggered in Rank 1: {len(flips_r1)}")
    rv_below_cutoff = (flips_r1["rv_val"] < 48.4).sum()
    rv_above_cutoff = (flips_r1["rv_val"] >= 48.4).sum()
    print(f" In Rank 1, when price hit R <= -0.41%:")
    print(f"  - Checkpoints where RV < 48.4 (Filtered by Rank 2): {rv_below_cutoff}회 ({rv_below_cutoff/len(flips_r1)*100:.1f}%)")
    print(f"  - Checkpoints where RV >= 48.4 (Passed by Rank 2):  {rv_above_cutoff}회 ({rv_above_cutoff/len(flips_r1)*100:.1f}%)")

if __name__ == '__main__':
    main()
