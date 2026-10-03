# -*- coding: utf-8 -*-
"""
test_fork7_recent_month.py
Faithfully backtest Fork 7 Candidate 3-EG on the recent 35 days (and past months)
using the exact production parameters and logic implemented in CATS.
"""

import json, os, sys
import numpy as np
import pandas as pd

# Load Fork 7 params
params_path = "e:/Devs/agTest/cats/config/fork7_candidate3_params.json"
with open(params_path, "r", encoding="utf-8") as f:
    f7_params = json.load(f)

cut_1m_bp = f7_params["cut_1m_bp"]   # -43.1 bp
t_min = f7_params["t_min"]           # 45m
mfe_cap_bp = f7_params["mfe_cap_bp"] # 100.0 bp
H_MAX = f7_params["H_MAX"]           # 720m
q07_curve = np.array(f7_params["q07_curve"])

def run_fork7_simulation(df):
    df = df.copy()
    df.sort_values("timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)
    
    n = len(df)
    c = df["close"].values
    h = df["high"].values
    l = df["low"].values
    v = df["volume"].values
    ts = pd.to_datetime(df["timestamp"]).values
    
    # Precompute 1m log returns
    lr = np.r_[0, np.diff(np.log(c))]
    
    # Hourly groupings for OLS
    # Each bar's hour key
    dt_series = pd.to_datetime(df["timestamp"])
    hour_keys = dt_series.dt.floor("H").values
    minutes_in_hour = dt_series.dt.minute.values
    
    # Track hourly bar aggregations
    # To be 100% causal and fast:
    # Build completed hourly bars
    hourly_df = df.groupby(dt_series.dt.floor("H")).agg(
        high=("high", "max"),
        low=("low", "max"), # placeholder
        hiMin=("high", "idxmax"),
        loMin=("low", "idxmin")
    )
    # Actually, calculate minute of high/low within hour
    hourly_summary = []
    # Let's aggregate hourly bars cleanly:
    cur_h = None
    cur_hi = -1e9; cur_lo = 1e9
    cur_hi_m = 0; cur_lo_m = 0
    
    # We will compute signals sequentially:
    # First, let's identify all completed hours
    # Each hour: {h_start, high, low, hiMin, loMin}
    hour_list = []
    h_map = {} # h_key -> index in hour_list
    
    for i in range(n):
        hk = hour_keys[i]
        m = minutes_in_hour[i]
        hi_val = h[i]; lo_val = l[i]
        if cur_h is None or hk != cur_h:
            if cur_h is not None:
                h_map[cur_h] = len(hour_list)
                hour_list.append({
                    "hKey": cur_h, "high": cur_hi, "low": cur_lo,
                    "hiMin": cur_hi_m, "loMin": cur_lo_m
                })
            cur_h = hk
            cur_hi = hi_val; cur_lo = lo_val
            cur_hi_m = m; cur_lo_m = m
        else:
            if hi_val > cur_hi:
                cur_hi = hi_val
                cur_hi_m = m
            if lo_val < cur_lo:
                cur_lo = lo_val
                cur_lo_m = m
    if cur_h is not None:
        h_map[cur_h] = len(hour_list)
        hour_list.append({
            "hKey": cur_h, "high": cur_hi, "low": cur_lo,
            "hiMin": cur_hi_m, "loMin": cur_lo_m
        })
        
    print(f"Total bars: {n:,}, Total completed hours: {len(hour_list)}")
    
    # Precompute rolling pos24 (1440 bars)
    # pos24: rolling max of high, rolling min of low over 1440 bars
    s_h = pd.Series(h)
    s_l = pd.Series(l)
    roll_hi24 = s_h.rolling(1440).max().values
    roll_lo24 = s_l.rolling(1440).min().values
    
    # Precompute z_ret and z_vol over 1440 bars
    # z_ret = (lr - mean_lr) / std_lr
    s_lr = pd.Series(lr)
    roll_mean_lr = s_lr.rolling(1440).mean().values
    roll_std_lr = s_lr.rolling(1440).std().values + 1e-12
    z_ret_arr = (lr - roll_mean_lr) / roll_std_lr
    
    # Robust volume z-score
    s_v = pd.Series(v)
    roll_med_v = s_v.rolling(1440).median().values
    # Approximate MAD or exact
    # In CATS: MAD is median of |v - med| * 1.4826
    # Let's compute fast rolling MAD:
    roll_mad_v = (s_v - pd.Series(roll_med_v)).abs().rolling(1440).median().values * 1.4826 + 1e-9
    z_vol_arr = (v - roll_med_v) / roll_mad_v
    
    # Signal detection loop
    signals = np.zeros(n, dtype=int)
    
    # Cache OLS per hour:
    ols_cache = {}
    
    def get_ols(hk):
        if hk in ols_cache:
            return ols_cache[hk]
        idx = h_map.get(hk, -1)
        if idx < 24: # need at least 24 completed hours before current hour
            ols_cache[hk] = None
            return None
        last24 = hour_list[idx-24 : idx]
        ptsHi_x = [i + b["hiMin"]/60.0 for i, b in enumerate(last24)]
        ptsHi_y = [b["high"] for b in last24]
        ptsLo_x = [i + b["loMin"]/60.0 for i, b in enumerate(last24)]
        ptsLo_y = [b["low"] for b in last24]
        
        m_x_hi, m_y_hi = np.mean(ptsHi_x), np.mean(ptsHi_y)
        m_x_lo, m_y_lo = np.mean(ptsLo_x), np.mean(ptsLo_y)
        
        den_hi = np.sum((ptsHi_x - m_x_hi)**2)
        num_hi = np.sum((ptsHi_x - m_x_hi) * (ptsHi_y - m_y_hi))
        A1 = num_hi / den_hi if den_hi > 1e-9 else 0.0
        A0 = m_y_hi - A1 * m_x_hi
        
        den_lo = np.sum((ptsLo_x - m_x_lo)**2)
        num_lo = np.sum((ptsLo_x - m_x_lo) * (ptsLo_y - m_y_lo))
        B1 = num_lo / den_lo if den_lo > 1e-9 else 0.0
        B0 = m_y_lo - B1 * m_x_lo
        
        res_hi = np.sum((ptsHi_y - (A0 + A1 * np.array(ptsHi_x)))**2)
        res_lo = np.sum((ptsLo_y - (B0 + B1 * np.array(ptsLo_x)))**2)
        sigma_hi = np.sqrt(res_hi / 22.0) + 1e-9
        sigma_lo = np.sqrt(res_lo / 22.0) + 1e-9
        
        res = (A0, A1, B0, B1, sigma_hi, sigma_lo)
        ols_cache[hk] = res
        return res

    print("Detecting Fork 7 signals...")
    for i in range(1440, n):
        hk_curr = hour_keys[i]
        hk_prev = hour_keys[i-1]
        
        ols_curr = get_ols(hk_curr)
        if ols_curr is None:
            continue
            
        A0, A1, B0, B1, sigma_hi, sigma_lo = ols_curr
        
        curMin = minutes_in_hour[i]
        prevMin = minutes_in_hour[i-1]
        
        xx_curr = 24.0 + curMin / 60.0
        xx_prev = (24.0 if hk_prev == hk_curr else 23.0) + prevMin / 60.0
        
        pred_hi_curr = A0 + A1 * xx_curr
        pred_lo_curr = B0 + B1 * xx_curr
        zU_curr = (c[i] - pred_hi_curr) / sigma_hi
        zL_curr = (pred_lo_curr - c[i]) / sigma_lo
        
        pred_hi_prev = A0 + A1 * xx_prev
        pred_lo_prev = B0 + B1 * xx_prev
        zU_prev = (c[i-1] - pred_hi_prev) / sigma_hi
        zL_prev = (pred_lo_prev - c[i-1]) / sigma_lo
        
        # Node E
        sigE = 0
        if zU_prev < 2.0 and zU_curr >= 2.0:
            sigE = 1
        elif zL_prev < 2.0 and zL_curr >= 2.0:
            sigE = -1
            
        # Node G
        sigG = 0
        if abs(z_ret_arr[i]) >= 4.0 and z_vol_arr[i] >= 5.0:
            if lr[i] > 0 and zU_curr >= 1.0:
                sigG = 1
            elif lr[i] < 0 and zL_curr >= 1.0:
                sigG = -1
                
        rawSig = sigE if sigE != 0 else sigG
        if rawSig == 0:
            continue
            
        # pos24 filter
        hi24 = roll_hi24[i]
        lo24 = roll_lo24[i]
        range24 = max(1e-9, hi24 - lo24)
        pos24 = (c[i] - lo24) / range24 if rawSig == 1 else (hi24 - c[i]) / range24
        
        if pos24 >= 0.67:
            signals[i] = rawSig

    sig_count = (signals != 0).sum()
    print(f"Eligible Fork 7 Signals generated: {sig_count} (Longs: {(signals == 1).sum()}, Shorts: {(signals == -1).sum()})")
    
    # -------------------------------------------------------------
    # State Machine: Simulation of Trades & Exits
    # -------------------------------------------------------------
    trades = []
    pos = 0 # 0, 1 (LONG), -1 (SHORT)
    entry_p = 0.0
    entry_t = -1
    max_price_move_pct = -1e9
    cooldown_until_t = -1
    
    for t in range(n):
        curr_p = c[t]
        
        # In Position: evaluate exits
        if pos != 0:
            elapsed_min = t - entry_t
            price_move_pct = pos * (curr_p - entry_p) / entry_p * 100.0
            if price_move_pct > max_price_move_pct:
                max_price_move_pct = price_move_pct
                
            price_move_bp = price_move_pct * 100.0
            mfe_bp = max_price_move_pct * 100.0
            
            exit_type = None
            
            # 1. 720m Expiry Exit
            if elapsed_min >= H_MAX:
                exit_type = "720m_expiry"
            # 2. 1m Micro Firewall (1 <= elapsed_min < 5, price_move_bp <= -43.1 bp)
            elif 1 <= elapsed_min < 5 and price_move_bp <= cut_1m_bp:
                exit_type = "1m_micro_firewall"
            # 3. Dynamic Q07 Envelope (t_min <= elapsed_min < H_MAX)
            elif t_min <= elapsed_min < H_MAX:
                q07 = q07_curve[elapsed_min]
                if price_move_bp <= q07 and mfe_bp <= mfe_cap_bp:
                    exit_type = "dynamic_q07_envelope"
                    
            if exit_type is not None:
                r_trade = pos * (curr_p - entry_p) / entry_p * 100.0
                trades.append({
                    "entry_t": entry_t, "exit_t": t,
                    "entry_time": ts[entry_t], "exit_time": ts[t],
                    "side": "LONG" if pos == 1 else "SHORT",
                    "entry_p": entry_p, "exit_p": curr_p,
                    "r": r_trade, "exit_type": exit_type,
                    "elapsed_min": elapsed_min, "mfe_bp": mfe_bp
                })
                pos = 0
                entry_p = 0.0
                # Cooldown holds until original entry_t + 720m
                cooldown_until_t = entry_t + H_MAX
                
        # Not in position: check for new signals
        if pos == 0:
            if t < cooldown_until_t:
                continue # in cooldown (No Re-entry rule)
                
            sig = signals[t]
            if sig != 0:
                pos = sig
                entry_p = curr_p
                entry_t = t
                max_price_move_pct = 0.0
                cooldown_until_t = entry_t + H_MAX
                
    if pos != 0:
        trades.append({
            "entry_t": entry_t, "exit_t": n - 1,
            "entry_time": ts[entry_t], "exit_time": ts[-1],
            "side": "LONG" if pos == 1 else "SHORT",
            "entry_p": entry_p, "exit_p": c[-1],
            "r": pos * (c[-1] - entry_p) / entry_p * 100.0,
            "exit_type": "end_of_data",
            "elapsed_min": (n - 1) - entry_t, "mfe_bp": max_price_move_pct * 100.0
        })
        
    df_trades = pd.DataFrame(trades)
    return df_trades

def main():
    print("=" * 80)
    print(" 1. 최근 35일 라이브 데이터 (2026-08-29 ~ 2026-10-03) 포크 7 백테스트")
    print("=" * 80)
    df_live = pd.read_parquet("e:/Devs/agTest/cats/scratch/recent_35d_btc_1m.parquet")
    df_t_live = run_fork7_simulation(df_live)
    
    # Filter trades within the recent 30 days (2026-09-03 ~ 2026-10-03)
    r30_start = df_live["timestamp"].max() - pd.Timedelta(days=30)
    df_t_r30 = df_t_live[df_t_live["entry_time"] >= r30_start].copy()
    
    # Filter trades within September 2026 (2026-09-01 ~ 2026-09-30)
    df_t_sep = df_t_live[(df_t_live["entry_time"] >= "2026-09-01") & (df_t_live["entry_time"] <= "2026-09-30 23:59:59")].copy()
    
    def print_perf(title, dt):
        print(f"\n--- {title} ---")
        if len(dt) == 0:
            print("거래 내역 없음 (0회)")
            return
        tot_r = dt["r"].sum()
        net_r_8bp = tot_r - len(dt) * 0.08
        cum = np.cumsum(dt["r"].values)
        mdd = np.max(np.maximum.accumulate(cum) - cum) if len(cum) > 0 else 0.0
        wr = (dt["r"] > 0).mean() * 100.0
        
        print(f" 총 거래 수: {len(dt)}회 (승리: {(dt['r']>0).sum()}회, 패배: {(dt['r']<=0).sum()}회 | 승률: {wr:.1f}%)")
        print(f" 단순 누적 수익률 (Gross): {tot_r:+.2f}%")
        print(f" 수수료(8bp) 차감 순수익률 (Net): {net_r_8bp:+.2f}%")
        print(f" 최대 낙폭 (MDD): {mdd:.2f}%")
        print(f" 평균 보유 시간: {dt['elapsed_min'].mean():.1f}분 (약 {dt['elapsed_min'].mean()/60:.1f}시간)")
        print("\n [청산 유형별 분포]")
        print(dt["exit_type"].value_counts().to_string())
        print("\n [상세 거래 목록]")
        cols = ["entry_time", "side", "entry_p", "exit_p", "r", "elapsed_min", "exit_type"]
        print(dt[cols].to_string(index=False))

    print_perf("최근 30일 (2026-09-03 ~ 2026-10-03)", df_t_r30)
    print_perf("2026년 9월 전체 (2026-09-01 ~ 2026-09-30)", df_t_sep)
    print_perf("최근 35일 전체 (2026-08-29 ~ 2026-10-03)", df_t_live)

    # -------------------------------------------------------------
    # Compare with August 2026
    # -------------------------------------------------------------
    print("\n" + "=" * 80)
    print(" 2. 2026년 8월 데이터 (직전 월 비교)")
    print("=" * 80)
    df_aug = pd.read_parquet("E:/Devs/crypto_asset_auto_trader/datalake/raw/binance_um/klines/symbol=BTCUSDT/interval=1m/2026-08.parquet")
    df_t_aug = run_fork7_simulation(df_aug)
    print_perf("2026년 8월", df_t_aug)

if __name__ == '__main__':
    main()
