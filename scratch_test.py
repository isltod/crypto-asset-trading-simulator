import pandas as pd

def calculate_stoch_rsi(series, rsi_len=14, stoch_len=14, k_len=3, d_len=3):
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1/rsi_len, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/rsi_len, adjust=False).mean()
    rs = avg_gain / (avg_loss + 1e-9)
    rsi = 100 - (100 / (1 + rs))
    min_rsi = rsi.rolling(window=stoch_len).min()
    max_rsi = rsi.rolling(window=stoch_len).max()
    stoch = 100 * (rsi - min_rsi) / (max_rsi - min_rsi + 1e-9)
    k = stoch.rolling(window=k_len).mean()
    d = k.rolling(window=d_len).mean()
    return k, d

def main():
    import ccxt
    exchange = ccxt.binance()
    klines = exchange.fetch_ohlcv('BTC/USDT', '15m', limit=1000)
    df = pd.DataFrame(klines, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms') + pd.Timedelta(hours=9)
    k, d = calculate_stoch_rsi(df['close'])
    df['k'] = k
    df['d'] = d
    df['prev_k'] = df['k'].shift(1)
    df['prev_d'] = df['d'].shift(1)
    
    df_filtered = df[(df['timestamp'] >= '2026-06-10 16:00:00') & (df['timestamp'] <= '2026-06-10 18:00:00')]
    for i, row in df_filtered.iterrows():
        print(f"{row['timestamp']} | k: {row['k']:.2f} | d: {row['d']:.2f} | prev_k: {row['prev_k']:.2f} | prev_d: {row['prev_d']:.2f}")

if __name__ == '__main__':
    main()
