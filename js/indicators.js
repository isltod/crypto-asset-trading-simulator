import { state } from './state.js';

export function calculateEMA(values, period) {
    const ema = new Array(values.length).fill(0);
    if (values.length < period) return ema;

    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += values[i];
    }
    const sma = sum / period;
    ema[period - 1] = sma;

    const alpha = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
        ema[i] = values[i] * alpha + ema[i - 1] * (1 - alpha);
    }
    return ema;
}

export function aggregateKlines(history, timeframe) {
    const tfMap = {
        '1m': 60,
        '3m': 180,
        '5m': 300,
        '15m': 900,
        '30m': 1800,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
    };
    const interval = tfMap[timeframe] || 60;
    const grouped = {};
    for (const tick of history) {
        const key = Math.floor(tick.time / interval) * interval;
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(tick);
    }
    const aggregated = [];
    const keys = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    for (const key of keys) {
        const group = grouped[key];
        const open = group[0].open;
        const close = group[group.length - 1].close;
        let high = -Infinity;
        let low = Infinity;
        for (const tick of group) {
            if (tick.high > high) high = tick.high;
            if (tick.low < low) low = tick.low;
        }
        aggregated.push({
            time: key,
            open,
            high,
            low,
            close
        });
    }
    return aggregated;
}

export function calculateWaveTrend(formattedData, n1 = state.WT_CHANNEL_LEN, n2 = state.WT_AVG_LEN, sigLen = state.WT_SIG_LEN) {
    const len = formattedData.length;
    const wt1Data = [];
    const wt2Data = [];
    if (len < n1 + n2) return { wt1Data, wt2Data };

    const ap = formattedData.map(d => (d.high + d.low + d.close) / 3);
    const esa = calculateEMA(ap, n1);

    const absDiff = ap.map((val, idx) => Math.abs(val - esa[idx]));
    const d = calculateEMA(absDiff, n1);

    const ci = ap.map((val, idx) => {
        if (d[idx] === 0) return 0;
        return (val - esa[idx]) / (0.015 * d[idx]);
    });

    const wt1 = calculateEMA(ci, n2);

    const wt2 = new Array(len).fill(0);
    for (let i = sigLen - 1; i < len; i++) {
        let sum = 0;
        for (let j = 0; j < sigLen; j++) {
            sum += wt1[i - j];
        }
        wt2[i] = sum / sigLen;
    }

    const startIdx = n1 + n2;
    for (let i = 0; i < len; i++) {
        if (i < startIdx) {
            wt1Data.push({ time: formattedData[i].time });
            wt2Data.push({ time: formattedData[i].time });
        } else {
            wt1Data.push({ time: formattedData[i].time, value: wt1[i] });
            wt2Data.push({ time: formattedData[i].time, value: wt2[i] });
        }
    }

    return { wt1Data, wt2Data };
}

export function calculateMTFWaveTrend(formattedData, tf = state.WT_TF, n1 = state.WT_CHANNEL_LEN, n2 = state.WT_AVG_LEN, sigLen = state.WT_SIG_LEN, allowRepaint = state.WT_ALLOW_REPAINT) {
    const aggregated = aggregateKlines(formattedData, tf);
    const wtResult = calculateWaveTrend(aggregated, n1, n2, sigLen);

    const wt1Data = [];
    const wt2Data = [];

    let aggIdx = 0;
    for (let i = 0; i < formattedData.length; i++) {
        const t = formattedData[i].time;
        while (aggIdx + 1 < aggregated.length && aggregated[aggIdx + 1].time <= t) {
            aggIdx++;
        }

        const is1m = tf === '1m';
        const useIdx = (is1m || allowRepaint) ? aggIdx : aggIdx - 1;
        const currentAgg = useIdx >= 0 ? aggregated[useIdx] : null;

        if (currentAgg) {
            const wt1Obj = wtResult.wt1Data[useIdx];
            const wt2Obj = wtResult.wt2Data[useIdx];
            const wt1Val = wt1Obj ? wt1Obj.value : undefined;
            const wt2Val = wt2Obj ? wt2Obj.value : undefined;

            wt1Data.push({ time: t, value: wt1Val });
            wt2Data.push({ time: t, value: wt2Val });
        } else {
            wt1Data.push({ time: t });
            wt2Data.push({ time: t });
        }
    }

    return { wt1Data, wt2Data };
}

export function calculateMACDForKlines(klines, fast, slow, sig) {
    const closes = klines.map(k => k.close);
    const len = closes.length;
    const macdLine = new Array(len).fill(0);
    const signalLine = new Array(len).fill(0);
    const hist = new Array(len).fill(0);
    if (len < slow + sig) {
        return { macdLine, signalLine, hist };
    }
    const emaFast = calculateEMA(closes, fast);
    const emaSlow = calculateEMA(closes, slow);
    for (let i = 0; i < len; i++) {
        macdLine[i] = emaFast[i] - emaSlow[i];
    }
    const macdSlice = macdLine.slice(slow - 1);
    const emaSigSlice = calculateEMA(macdSlice, sig);
    for (let i = 0; i < len; i++) {
        if (i < slow - 1) {
            signalLine[i] = 0;
            hist[i] = 0;
        } else {
            signalLine[i] = emaSigSlice[i - (slow - 1)];
            hist[i] = macdLine[i] - signalLine[i];
        }
    }
    return { macdLine, signalLine, hist };
}

export function calculateMTFMacd(formattedData, tf = state.MACD_TF, fast = state.MACD_FAST, slow = state.MACD_SLOW, sig = state.MACD_SIG, allowRepaint = state.MACD_ALLOW_REPAINT) {
    const aggregated = aggregateKlines(formattedData, tf);
    const macdResult = calculateMACDForKlines(aggregated, fast, slow, sig);

    const macdData = [];
    const sigData = [];
    const histData = [];

    let aggIdx = 0;
    for (let i = 0; i < formattedData.length; i++) {
        const t = formattedData[i].time;
        while (aggIdx + 1 < aggregated.length && aggregated[aggIdx + 1].time <= t) {
            aggIdx++;
        }

        const is1m = tf === '1m';
        const useIdx = (is1m || allowRepaint) ? aggIdx : aggIdx - 1;
        const currentAgg = useIdx >= 0 ? aggregated[useIdx] : null;

        if (currentAgg) {
            const mVal = macdResult.macdLine[useIdx];
            const sVal = macdResult.signalLine[useIdx];
            const hVal = macdResult.hist[useIdx];

            let color = '#26a69a';
            if (hVal < 0) color = '#ef5350';

            macdData.push({ time: t, value: mVal });
            sigData.push({ time: t, value: sVal });
            histData.push({ time: t, value: hVal, color: color });
        } else {
            macdData.push({ time: t });
            sigData.push({ time: t });
            histData.push({ time: t });
        }
    }

    return { macdData, sigData, histData };
}

export function calculateRSI(closes, period = 14) {
    const len = closes.length;
    const rsi = new Array(len).fill(null);
    if (len < 2) return rsi;
    
    const alpha = 1 / period;
    let avgGain = closes[1] - closes[0] > 0 ? closes[1] - closes[0] : 0;
    let avgLoss = closes[1] - closes[0] < 0 ? Math.abs(closes[1] - closes[0]) : 0;
    
    rsi[1] = avgLoss === 0 ? 100 : (avgGain === 0 ? 0 : 100 - (100 / (1 + avgGain / avgLoss)));
    
    for (let i = 2; i < len; i++) {
        const change = closes[i] - closes[i - 1];
        let gain = 0;
        let loss = 0;
        if (change > 0) gain = change;
        else loss = Math.abs(change);
        
        avgGain = avgGain * (1 - alpha) + gain * alpha;
        avgLoss = avgLoss * (1 - alpha) + loss * alpha;
        
        if (avgLoss === 0) {
            rsi[i] = 100;
        } else if (avgGain === 0) {
            rsi[i] = 0;
        } else {
            const rs = avgGain / avgLoss;
            rsi[i] = 100 - (100 / (1 + rs));
        }
    }
    return rsi;
}

export function calculateStochRSI(klines, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
    const closes = klines.map(k => k.close);
    const rsi = calculateRSI(closes, rsiPeriod);
    const len = closes.length;
    const stochRsiRaw = new Array(len).fill(null);
    
    for (let i = 0; i < len; i++) {
        if (i < rsiPeriod + stochPeriod - 1) continue;
        
        let lowestRSI = rsi[i];
        let highestRSI = rsi[i];
        let valid = true;
        for (let j = i - stochPeriod + 1; j <= i; j++) {
            if (rsi[j] === null) {
                valid = false;
                break;
            }
            if (rsi[j] < lowestRSI) lowestRSI = rsi[j];
            if (rsi[j] > highestRSI) highestRSI = rsi[j];
        }
        
        if (!valid) continue;
        
        if (highestRSI === lowestRSI) {
            stochRsiRaw[i] = 0;
        } else {
            stochRsiRaw[i] = 100 * (rsi[i] - lowestRSI) / (highestRSI - lowestRSI);
        }
    }
    
    const kLine = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
        if (i < rsiPeriod + stochPeriod - 1 + kPeriod - 1) continue;
        let sum = 0;
        let valid = true;
        for (let j = i - kPeriod + 1; j <= i; j++) {
            if (stochRsiRaw[j] === null) {
                valid = false;
                break;
            }
            sum += stochRsiRaw[j];
        }
        if (valid) {
            kLine[i] = sum / kPeriod;
        }
    }
    
    const dLine = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
        if (i < rsiPeriod + stochPeriod - 1 + kPeriod - 1 + dPeriod - 1) continue;
        let sum = 0;
        let valid = true;
        for (let j = i - dPeriod + 1; j <= i; j++) {
            if (kLine[j] === null) {
                valid = false;
                break;
            }
            sum += kLine[j];
        }
        if (valid) {
            dLine[i] = sum / dPeriod;
        }
    }
    
    return { kLine, dLine };
}

export function calculateMTFStochRSI(formattedData, tf = state.STOCH_TF, rsiPeriod = state.STOCH_RSI_LEN, stochPeriod = state.STOCH_LEN, kPeriod = state.STOCH_K, dPeriod = state.STOCH_D, allowRepaint = state.STOCH_ALLOW_REPAINT) {
    const aggregated = aggregateKlines(formattedData, tf);
    const stochResult = calculateStochRSI(aggregated, rsiPeriod, stochPeriod, kPeriod, dPeriod);

    const kData = [];
    const dData = [];

    let aggIdx = 0;
    for (let i = 0; i < formattedData.length; i++) {
        const t = formattedData[i].time;
        while (aggIdx + 1 < aggregated.length && aggregated[aggIdx + 1].time <= t) {
            aggIdx++;
        }

        const is1m = tf === '1m';
        const useIdx = (is1m || allowRepaint) ? aggIdx : aggIdx - 1;
        const currentAgg = useIdx >= 0 ? aggregated[useIdx] : null;

        if (currentAgg) {
            const kVal = stochResult.kLine[useIdx];
            const dVal = stochResult.dLine[useIdx];

            kData.push({ time: t, value: kVal !== null ? kVal : undefined });
            dData.push({ time: t, value: dVal !== null ? dVal : undefined });
        } else {
            kData.push({ time: t });
            dData.push({ time: t });
        }
    }

    return { kData, dData };
}

export function calculateSupertrend(formattedData, period = 10, multiplier = 3.0) {
    const len = formattedData.length;
    if (len < period) return [];

    const tr = new Array(len);
    tr[0] = formattedData[0].high - formattedData[0].low;
    for (let i = 1; i < len; i++) {
        tr[i] = Math.max(
            formattedData[i].high - formattedData[i].low,
            Math.abs(formattedData[i].high - formattedData[i - 1].close),
            Math.abs(formattedData[i].low - formattedData[i - 1].close)
        );
    }

    const atr = new Array(len).fill(0);
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += tr[i];
    }
    atr[period - 1] = sum / period;
    for (let i = period; i < len; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }

    const basicUpperBand = new Array(len);
    const basicLowerBand = new Array(len);
    const finalUpperBand = new Array(len).fill(0);
    const finalLowerBand = new Array(len).fill(0);
    const trend = new Array(len).fill(1);

    for (let i = 0; i < len; i++) {
        const hl2 = (formattedData[i].high + formattedData[i].low) / 2;
        basicUpperBand[i] = hl2 + multiplier * atr[i];
        basicLowerBand[i] = hl2 - multiplier * atr[i];
    }

    finalUpperBand[0] = basicUpperBand[0];
    finalLowerBand[0] = basicLowerBand[0];

    for (let i = 1; i < len; i++) {
        if (basicUpperBand[i] < finalUpperBand[i - 1] || formattedData[i - 1].close > finalUpperBand[i - 1]) {
            finalUpperBand[i] = basicUpperBand[i];
        } else {
            finalUpperBand[i] = finalUpperBand[i - 1];
        }

        if (basicLowerBand[i] > finalLowerBand[i - 1] || formattedData[i - 1].close < finalLowerBand[i - 1]) {
            finalLowerBand[i] = basicLowerBand[i];
        } else {
            finalLowerBand[i] = finalLowerBand[i - 1];
        }

        if (formattedData[i].close > finalUpperBand[i - 1]) {
            trend[i] = 1;
        } else if (formattedData[i].close < finalLowerBand[i - 1]) {
            trend[i] = -1;
        } else {
            trend[i] = trend[i - 1];
        }
    }

    const results = [];
    const startIdx = period - 1;
    for (let i = 0; i < len; i++) {
        const t = formattedData[i].time;
        if (i < startIdx) {
            results.push({ time: t, value: null, trend: 1 });
        } else {
            results.push({
                time: t,
                value: trend[i] === 1 ? finalLowerBand[i] : finalUpperBand[i],
                trend: trend[i]
            });
        }
    }

    return results;
}
