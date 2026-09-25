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
        let volume = 0;
        for (const tick of group) {
            if (tick.high > high) high = tick.high;
            if (tick.low < low) low = tick.low;
            volume += (tick.volume || 0);
        }
        aggregated.push({
            time: key,
            open,
            high,
            low,
            close,
            volume
        });
    }

    // Merge with pre-cached MTF history from backend if available
    if (timeframe !== '1m' && state.mtfKlines && state.mtfKlines[timeframe] && state.mtfKlines[timeframe].length > 0) {
        const mtfHistory = state.mtfKlines[timeframe];
        const firstAggTime = aggregated.length > 0 ? aggregated[0].time : Infinity;
        const merged = mtfHistory.filter(k => k.time < firstAggTime);
        return merged.concat(aggregated);
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

export function calculateVWAPClimax(klines, window = 96, sigma = 2.0, volLookback = 30, volMult = 1.8, wickRatio = 0.8) {
    const len = klines.length;
    const vwapData = [];
    const upperBandData = [];
    const lowerBandData = [];
    const signals = new Array(len).fill(0);

    const volHistData = [];
    const volMaData = [];
    const volSurgeThreshData = [];
    const subMarkers = [];

    if (len === 0) {
        return { vwapData, upperBandData, lowerBandData, signals, volHistData, volMaData, volSurgeThreshData, subMarkers };
    }

    const typicalPrices = klines.map(k => (k.high + k.low + k.close) / 3.0);
    const volumes = klines.map(k => (k.volume !== undefined && k.volume > 0) ? k.volume : 1.0);
    const pv = typicalPrices.map((tp, idx) => tp * volumes[idx]);

    for (let i = 0; i < len; i++) {
        const t = klines[i].time;
        const currentWindow = Math.min(i + 1, window);

        let sumPV = 0;
        let sumVol = 0;
        let tpSum = 0;
        for (let j = i - currentWindow + 1; j <= i; j++) {
            sumPV += pv[j];
            sumVol += volumes[j];
            tpSum += typicalPrices[j];
        }

        const tpMean = tpSum / currentWindow;
        const vwapVal = sumVol > 0 ? (sumPV / sumVol) : tpMean;

        let tpSqDiff = 0;
        for (let j = i - currentWindow + 1; j <= i; j++) {
            tpSqDiff += Math.pow(typicalPrices[j] - tpMean, 2);
        }
        const stdVal = currentWindow > 1 ? Math.sqrt(tpSqDiff / currentWindow) : (typicalPrices[i] * 0.005);

        const upperVal = vwapVal + sigma * stdVal;
        const lowerVal = vwapVal - sigma * stdVal;

        vwapData.push({ time: t, value: vwapVal });
        upperBandData.push({ time: t, value: upperVal });
        lowerBandData.push({ time: t, value: lowerVal });

        const currentVolLookback = Math.min(i + 1, volLookback);
        let volMA = volumes[i];
        if (currentVolLookback >= 3) {
            let sumVolMA = 0;
            for (let j = i - currentVolLookback + 1; j <= i; j++) {
                sumVolMA += volumes[j];
            }
            volMA = sumVolMA / currentVolLookback;
        }

        const volRatio = volumes[i] / (volMA + 1e-8);
        const isVolSurge = (currentVolLookback >= 3) && (volRatio >= volMult);

        const open = klines[i].open;
        const close = klines[i].close;
        const high = klines[i].high;
        const low = klines[i].low;

        const isGreen = close >= open;
        let barColor = isGreen ? 'rgba(46, 189, 133, 0.65)' : 'rgba(246, 70, 93, 0.65)';
        if (isVolSurge) {
            barColor = '#f59e0b'; // Gold highlight on volume surge
        }

        volHistData.push({ time: t, value: volumes[i], color: barColor });
        volMaData.push({ time: t, value: volMA });
        volSurgeThreshData.push({ time: t, value: volMA * volMult });

        const body = Math.max(Math.abs(close - open), (high - low) * 0.05); // prevent 0 division
        const lowerWick = Math.min(open, close) - low;
        const upperWick = high - Math.max(open, close);
        const lowerWickRatio = lowerWick / body;
        const upperWickRatio = upperWick / body;
        const isLowerWick = lowerWickRatio >= wickRatio;
        const isUpperWick = upperWickRatio >= wickRatio;

        let sig = 0;
        if (close < lowerVal && isVolSurge && isLowerWick) {
            sig = 1;
        } else if (close > upperVal && isVolSurge && isUpperWick) {
            sig = -1;
        }
        signals[i] = sig;

        subMarkers.push({
            time: t,
            close,
            high,
            low,
            isVolSurge,
            isLowerWick,
            isUpperWick,
            volRatio,
            lowerWickRatio,
            upperWickRatio,
            signal: sig
        });
    }

    return { 
        vwapData, 
        upperBandData, 
        lowerBandData, 
        signals, 
        volHistData, 
        volMaData, 
        volSurgeThreshData, 
        subMarkers 
    };
}

export function calculateMTFVWAPClimax(
    formattedData,
    tf = state.V_TF || '15m',
    window = state.V_VWAP_WINDOW || 96,
    sigma = state.V_VWAP_SIGMA || 2.0,
    volLookback = state.V_VOL_LOOKBACK || 30,
    volMult = state.V_VOL_MULT || 1.8,
    wickRatio = state.V_WICK_RATIO || 0.8,
    allowRepaint = state.V_ALLOW_REPAINT || false
) {
    if (!formattedData || formattedData.length === 0) {
        return { 
            vwapData: [], 
            upperBandData: [], 
            lowerBandData: [], 
            signals: [], 
            volHistData: [], 
            volMaData: [], 
            volSurgeThreshData: [],
            subMarkers: [] 
        };
    }

    const aggregated = aggregateKlines(formattedData, tf);
    const vResult = calculateVWAPClimax(aggregated, window, sigma, volLookback, volMult, wickRatio);

    const vwapData = [];
    const upperBandData = [];
    const lowerBandData = [];
    const signals = [];
    const volHistData = [];
    const volMaData = [];
    const volSurgeThreshData = [];

    let aggIdx = 0;
    for (let i = 0; i < formattedData.length; i++) {
        const t = formattedData[i].time;
        while (aggIdx + 1 < aggregated.length && aggregated[aggIdx + 1].time <= t) {
            aggIdx++;
        }

        const is1m = tf === '1m';
        const useIdx = (is1m || allowRepaint) ? aggIdx : aggIdx - 1;
        const currentAgg = useIdx >= 0 ? aggregated[useIdx] : null;

        if (currentAgg && useIdx < vResult.vwapData.length && vResult.vwapData[useIdx] && vResult.vwapData[useIdx].value !== undefined) {
            const vObj = vResult.vwapData[useIdx];
            const uObj = vResult.upperBandData[useIdx];
            const lObj = vResult.lowerBandData[useIdx];
            const sig = vResult.signals[useIdx] || 0;

            const vHist = vResult.volHistData[useIdx];
            const vMa = vResult.volMaData[useIdx];
            const vSurge = vResult.volSurgeThreshData[useIdx];

            vwapData.push({ time: t, value: vObj.value });
            upperBandData.push({ time: t, value: uObj.value });
            lowerBandData.push({ time: t, value: lObj.value });
            signals.push({ time: t, value: sig });

            volHistData.push({ time: t, value: vHist ? vHist.value : 0, color: vHist ? vHist.color : undefined });
            volMaData.push({ time: t, value: vMa ? vMa.value : 0 });
            volSurgeThreshData.push({ time: t, value: vSurge ? vSurge.value : 0 });
        } else {
            const tp = (formattedData[i].high + formattedData[i].low + formattedData[i].close) / 3.0;
            vwapData.push({ time: t, value: tp });
            upperBandData.push({ time: t, value: tp });
            lowerBandData.push({ time: t, value: tp });
            signals.push({ time: t, value: 0 });

            volHistData.push({ time: t, value: formattedData[i].volume || 0 });
            volMaData.push({ time: t, value: formattedData[i].volume || 0 });
            volSurgeThreshData.push({ time: t, value: (formattedData[i].volume || 0) * volMult });
        }
    }

    // subMarkers only for completed 15m candles (or realtime bar only if allowRepaint is true)
    const subMarkers = [];
    if (vResult.subMarkers && vResult.subMarkers.length > 0) {
        const tfMap = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
        const interval = tfMap[tf] || 900;
        const formattedTimeSet = new Set(formattedData.map(d => d.time));

        // When allowRepaint is false, exclude the very last incomplete candle (aggregated.length - 1)
        const maxIdx = (tf === '1m' || allowRepaint) ? vResult.subMarkers.length : vResult.subMarkers.length - 1;

        for (let idx = 0; idx < maxIdx; idx++) {
            const m = vResult.subMarkers[idx];
            const matchTime = m.time + interval;

            // Only add marker if the completed candle timestamp actually exists in the formatted 1m timeline
            if (formattedTimeSet.has(matchTime)) {
                subMarkers.push({
                    ...m,
                    time: matchTime
                });
            }
        }
    }

    return { 
        vwapData, 
        upperBandData, 
        lowerBandData, 
        signals, 
        rawAggregated: aggregated, 
        rawSignals: vResult.signals,
        volHistData,
        volMaData,
        volSurgeThreshData,
        subMarkers
    };
}

export function calculateExtremeBreakoutMarkers(formattedData) {
    if (!formattedData || formattedData.length < 30) return [];
    const len = formattedData.length;

    // 24h (1440m) average 1m volume
    const lookback24h = Math.min(len, 1440);
    let sumVol24h = 0;
    for (let i = len - lookback24h; i < len; i++) {
        sumVol24h += formattedData[i].volume || 0;
    }
    const avg24h1mVol = sumVol24h / lookback24h;

    function getSignalAt(idx) {
        if (idx < 15) return 0;
        const curr = formattedData[idx].close;
        const past = formattedData[idx - 15].close;
        const ret15 = ((curr - past) / (past + 1e-9)) * 100;

        let vol15 = 0;
        for (let j = idx - 14; j <= idx; j++) {
            vol15 += formattedData[j].volume || 0;
        }
        const volSurge = vol15 / (avg24h1mVol * 15 + 1e-9);

        let totalPath = 0;
        for (let j = idx - 14; j <= idx; j++) {
            totalPath += Math.abs(formattedData[j].close - formattedData[j - 1].close);
        }
        const netChange = Math.abs(curr - past);
        const er = netChange / (totalPath + 1e-9);

        if (volSurge >= 2.5 && er >= 0.45) {
            if (ret15 >= 0.7) return 1;
            if (ret15 <= -0.7) return -1;
        }
        return 0;
    }

    const rawSignals = new Array(len).fill(0);
    for (let i = 15; i < len; i++) {
        rawSignals[i] = getSignalAt(i);
    }

    const markers = [];
    let inRun = false;
    let runStartIdx = -1;
    let prevRunLen = 0;

    for (let i = 15; i < len; i++) {
        const sig = rawSignals[i];
        if (sig !== 0) {
            if (!inRun) {
                inRun = true;
                runStartIdx = i;

                // A1 Filter check
                const isBlockedByA1 = prevRunLen >= 5;
                if (!isBlockedByA1) {
                    markers.push({
                        time: formattedData[i].time,
                        position: sig === 1 ? 'belowBar' : 'aboveBar',
                        color: sig === 1 ? '#10b981' : '#f43f5e',
                        shape: sig === 1 ? 'arrowUp' : 'arrowDown',
                        text: sig === 1 ? 'EB LONG' : 'EB SHORT',
                        size: 2
                    });
                }
            } else {
                const isBlockedByA1 = prevRunLen >= 5;
                if (!isBlockedByA1) {
                    markers.push({
                        time: formattedData[i].time,
                        position: sig === 1 ? 'belowBar' : 'aboveBar',
                        color: sig === 1 ? '#10b981' : '#f43f5e',
                        shape: 'circle',
                        size: 0.8
                    });
                }
            }
        } else {
            if (inRun) {
                prevRunLen = i - runStartIdx;
                inRun = false;
                runStartIdx = -1;
            }
        }
    }

    return markers;
}

export function calculateVolumeBarData(formattedData) {
    if (!formattedData || formattedData.length === 0) return [];
    const len = formattedData.length;
    const lookback24h = Math.min(len, 1440);

    let sumVol24h = 0;
    for (let i = len - lookback24h; i < len; i++) {
        sumVol24h += formattedData[i].volume || 0;
    }
    const avg24h1mVol = sumVol24h / lookback24h;

    const volBars = [];
    for (let i = 0; i < len; i++) {
        const d = formattedData[i];
        const v = d.volume || 0;

        let vol15 = 0;
        const start = Math.max(0, i - 14);
        for (let j = start; j <= i; j++) {
            vol15 += formattedData[j].volume || 0;
        }
        const volSurge = vol15 / (avg24h1mVol * 15 + 1e-9);

        let color = d.close >= d.open ? 'rgba(46, 189, 133, 0.45)' : 'rgba(246, 70, 93, 0.45)';
        if (volSurge >= 2.5 && v >= avg24h1mVol * 1.5) {
            // Option C volume explosion: Peak explosion bar highlighted in vibrant Gold
            color = '#f59e0b';
        } else if (volSurge >= 2.5) {
            // Within active surge window: subtle warm amber tint
            color = d.close >= d.open ? 'rgba(245, 158, 11, 0.5)' : 'rgba(244, 63, 94, 0.5)';
        }

        volBars.push({
            time: d.time,
            value: v,
            color: color
        });
    }
    return volBars;
}

function buildFork7Context(formattedData, mtf1h = null) {
    const len = formattedData.length;
    const hourlyBars = [];
    const hKeyToIdx = new Map();

    const first1mHour = Math.floor(formattedData[0].time / 3600) * 3600;

    // 1. Preload preceding 1h bars from MTF cache if available
    if (mtf1h && mtf1h.length > 0) {
        for (let i = 0; i < mtf1h.length; i++) {
            const hb = mtf1h[i];
            if (hb.time < first1mHour) {
                hKeyToIdx.set(hb.time, hourlyBars.length);
                hourlyBars.push({
                    hKey: hb.time,
                    high: hb.high,
                    low: hb.low,
                    hiMin: 30, // midpoint fallback for pre-loaded 1h bars
                    loMin: 30
                });
            }
        }
    }

    // 2. Aggregate 1m bars from formattedData
    let curHKey = null;
    let hHigh = -Infinity, hLow = Infinity, hiMin = 0, loMin = 0;

    for (let i = 0; i < len; i++) {
        const k = formattedData[i];
        const hKey = Math.floor(k.time / 3600) * 3600;
        const m = Math.floor((k.time % 3600) / 60);

        if (curHKey === null || hKey !== curHKey) {
            if (curHKey !== null) {
                hKeyToIdx.set(curHKey, hourlyBars.length);
                hourlyBars.push({ hKey: curHKey, high: hHigh, low: hLow, hiMin, loMin });
            }
            curHKey = hKey;
            hHigh = k.high;
            hLow = k.low;
            hiMin = m;
            loMin = m;
        } else {
            if (k.high > hHigh) {
                hHigh = k.high;
                hiMin = m;
            }
            if (k.low < hLow) {
                hLow = k.low;
                loMin = m;
            }
        }
    }

    const olsCache = new Map();

    function getOLS(hKeyCurr) {
        if (olsCache.has(hKeyCurr)) return olsCache.get(hKeyCurr);

        let lastIdx = hourlyBars.length;
        if (hKeyToIdx.has(hKeyCurr)) {
            lastIdx = hKeyToIdx.get(hKeyCurr);
        } else {
            for (let i = 0; i < hourlyBars.length; i++) {
                if (hourlyBars[i].hKey >= hKeyCurr) {
                    lastIdx = i;
                    break;
                }
            }
        }

        if (lastIdx < 24) {
            olsCache.set(hKeyCurr, null);
            return null;
        }

        const last24 = hourlyBars.slice(lastIdx - 24, lastIdx);
        let sumX_hi = 0, sumY_hi = 0, sumX_lo = 0, sumY_lo = 0;
        const ptsHi = [], ptsLo = [];
        for (let i = 0; i < 24; i++) {
            const hb = last24[i];
            const x_hi = i + hb.hiMin / 60.0;
            const y_hi = hb.high;
            const x_lo = i + hb.loMin / 60.0;
            const y_lo = hb.low;
            ptsHi.push({ x: x_hi, y: y_hi });
            ptsLo.push({ x: x_lo, y: y_lo });
            sumX_hi += x_hi; sumY_hi += y_hi;
            sumX_lo += x_lo; sumY_lo += y_lo;
        }
        const meanX_hi = sumX_hi / 24, meanY_hi = sumY_hi / 24;
        const meanX_lo = sumX_lo / 24, meanY_lo = sumY_lo / 24;

        let num_hi = 0, den_hi = 0, num_lo = 0, den_lo = 0;
        for (let i = 0; i < 24; i++) {
            num_hi += (ptsHi[i].x - meanX_hi) * (ptsHi[i].y - meanY_hi);
            den_hi += Math.pow(ptsHi[i].x - meanX_hi, 2);
            num_lo += (ptsLo[i].x - meanX_lo) * (ptsLo[i].y - meanY_lo);
            den_lo += Math.pow(ptsLo[i].x - meanX_lo, 2);
        }
        const A1 = den_hi > 1e-9 ? num_hi / den_hi : 0;
        const A0 = meanY_hi - A1 * meanX_hi;
        const B1 = den_lo > 1e-9 ? num_lo / den_lo : 0;
        const B0 = meanY_lo - B1 * meanX_lo;

        let resSum_hi = 0, resSum_lo = 0;
        for (let i = 0; i < 24; i++) {
            const pred_hi = A0 + A1 * ptsHi[i].x;
            const pred_lo = B0 + B1 * ptsLo[i].x;
            resSum_hi += Math.pow(ptsHi[i].y - pred_hi, 2);
            resSum_lo += Math.pow(ptsLo[i].y - pred_lo, 2);
        }
        const sigma_hi = Math.sqrt(resSum_hi / 22) + 1e-9;
        const sigma_lo = Math.sqrt(resSum_lo / 22) + 1e-9;

        const model = { A0, A1, B0, B1, sigma_hi, sigma_lo };
        olsCache.set(hKeyCurr, model);
        return model;
    }

    return { getOLS };
}

export function calculateFork7SeriesData(formattedData, mtf1h = null) {
    if (!formattedData || formattedData.length === 0) {
        return {
            olsUpperData: [],
            olsLowerData: [],
            pos24LongData: [],
            pos24ShortData: [],
            volThreshData: []
        };
    }

    const { getOLS } = buildFork7Context(formattedData, mtf1h);
    const len = formattedData.length;

    const olsUpperData = [];
    const olsLowerData = [];
    const pos24LongData = [];
    const pos24ShortData = [];
    const volThreshData = [];

    let lastVolThresh = 0;

    for (let i = 0; i < len; i++) {
        const tick = formattedData[i];
        const hKey = Math.floor(tick.time / 3600) * 3600;
        const model = getOLS(hKey);

        if (model) {
            const m = Math.floor((tick.time % 3600) / 60);
            const xx = 24 + m / 60.0;
            const pred_hi = model.A0 + model.A1 * xx;
            const pred_lo = model.B0 + model.B1 * xx;
            olsUpperData.push({ time: tick.time, value: pred_hi + 2.0 * model.sigma_hi });
            olsLowerData.push({ time: tick.time, value: pred_lo - 2.0 * model.sigma_lo });
        }

        // pos24 bounds
        let hi24 = -Infinity, lo24 = Infinity;
        const startIdx = Math.max(0, i - 1439);
        for (let j = startIdx; j <= i; j++) {
            if (formattedData[j].high > hi24) hi24 = formattedData[j].high;
            if (formattedData[j].low < lo24) lo24 = formattedData[j].low;
        }
        if (i < 1439 && mtf1h && mtf1h.length > 0) {
            const targetStartTime = formattedData[i].time - 86400;
            for (let k = mtf1h.length - 1; k >= 0; k--) {
                const hb = mtf1h[k];
                if (hb.time + 3600 <= targetStartTime) break;
                if (hb.time < formattedData[0].time) {
                    if (hb.high > hi24) hi24 = hb.high;
                    if (hb.low < lo24) lo24 = hb.low;
                }
            }
        }
        const range24 = Math.max(1e-9, hi24 - lo24);
        pos24LongData.push({ time: tick.time, value: lo24 + 0.67 * range24 });
        pos24ShortData.push({ time: tick.time, value: lo24 + 0.33 * range24 });

        // Node G Volume threshold (5.0σ MAD)
        if (i % 5 === 0 || lastVolThresh === 0) {
            const lookback = Math.min(i, 1440);
            if (lookback >= 15) {
                const vols = [];
                for (let j = i - lookback + 1; j <= i; j++) vols.push(formattedData[j].volume || 0);
                vols.sort((a, b) => a - b);
                const midIdx = Math.floor(vols.length / 2);
                const med_vol = vols.length % 2 === 0 ? (vols[midIdx - 1] + vols[midIdx]) / 2 : vols[midIdx];
                const devVols = vols.map(v => Math.abs(v - med_vol)).sort((a, b) => a - b);
                const mad_vol = (devVols.length % 2 === 0 ? (devVols[midIdx - 1] + devVols[midIdx]) / 2 : devVols[midIdx]) * 1.4826 + 1e-9;
                lastVolThresh = med_vol + 5.0 * mad_vol;
            }
        }
        if (lastVolThresh > 0) {
            volThreshData.push({ time: tick.time, value: lastVolThresh });
        }
    }

    return {
        olsUpperData,
        olsLowerData,
        pos24LongData,
        pos24ShortData,
        volThreshData
    };
}

export function calculateFork7Candidate3Markers(formattedData, mtf1h = null) {
    if (!formattedData || formattedData.length < 2) return [];
    const len = formattedData.length;

    const { getOLS } = buildFork7Context(formattedData, mtf1h);

    const markers = [];
    let cooldownUntilIdx = -1;

    for (let i = 1; i < len; i++) {
        const currentTick = formattedData[i];
        const prevTick = formattedData[i - 1];
        const currentHourKey = Math.floor(currentTick.time / 3600) * 3600;

        const model = getOLS(currentHourKey);
        if (!model) continue;

        const curMin = Math.floor((currentTick.time % 3600) / 60);
        const xx_curr = 24 + curMin / 60.0;
        const pred_hi_curr = model.A0 + model.A1 * xx_curr;
        const pred_lo_curr = model.B0 + model.B1 * xx_curr;
        const zU_curr = (currentTick.close - pred_hi_curr) / model.sigma_hi;
        const zL_curr = (pred_lo_curr - currentTick.close) / model.sigma_lo;

        const prevMin = Math.floor((prevTick.time % 3600) / 60);
        const xx_prev = (Math.floor(prevTick.time / 3600) * 3600 === currentHourKey ? 24 : 23) + prevMin / 60.0;
        const pred_hi_prev = model.A0 + model.A1 * xx_prev;
        const pred_lo_prev = model.B0 + model.B1 * xx_prev;
        const zU_prev = (prevTick.close - pred_hi_prev) / model.sigma_hi;
        const zL_prev = (pred_lo_prev - prevTick.close) / model.sigma_lo;

        // Node E Detection
        let sigE = 0;
        if (zU_prev < 2.0 && zU_curr >= 2.0) sigE = 1;
        else if (zL_prev < 2.0 && zL_curr >= 2.0) sigE = -1;

        // Node G Detection
        let sigG = 0;
        const lr_curr = Math.log(currentTick.close / (prevTick.close + 1e-9));
        if (Math.abs(lr_curr) >= 0.003 && i >= 15) {
            const lookback = Math.min(i, 1440);
            let sum_lr = 0, sum_sq_lr = 0;
            const vols = [];
            for (let j = i - lookback + 1; j <= i; j++) {
                const lr = Math.log(formattedData[j].close / (formattedData[j - 1].close + 1e-9));
                sum_lr += lr;
                sum_sq_lr += lr * lr;
                vols.push(formattedData[j].volume || 0);
            }
            const mean_lr = sum_lr / lookback;
            const var_lr = Math.max(1e-12, sum_sq_lr / lookback - mean_lr * mean_lr);
            const std_lr = Math.sqrt(var_lr);
            const z_ret = (lr_curr - mean_lr) / std_lr;

            vols.sort((a, b) => a - b);
            const midIdx = Math.floor(vols.length / 2);
            const med_vol = vols.length % 2 === 0 ? (vols[midIdx - 1] + vols[midIdx]) / 2 : vols[midIdx];
            const devVols = vols.map(v => Math.abs(v - med_vol)).sort((a, b) => a - b);
            const mad_vol = (devVols.length % 2 === 0 ? (devVols[midIdx - 1] + devVols[midIdx]) / 2 : devVols[midIdx]) * 1.4826 + 1e-9;
            const z_vol = ((currentTick.volume || 0) - med_vol) / mad_vol;

            if (Math.abs(z_ret) >= 4.0 && z_vol >= 5.0) {
                if (lr_curr > 0 && zU_curr >= 1.0) sigG = 1;
                else if (lr_curr < 0 && zL_curr >= 1.0) sigG = -1;
            }
        }

        const rawSig = sigE !== 0 ? sigE : sigG;
        if (rawSig === 0) continue;

        // pos24 filter check
        let hi24 = -Infinity, lo24 = Infinity;
        const startIdx = Math.max(0, i - 1439);
        for (let j = startIdx; j <= i; j++) {
            if (formattedData[j].high > hi24) hi24 = formattedData[j].high;
            if (formattedData[j].low < lo24) lo24 = formattedData[j].low;
        }
        if (i < 1439 && mtf1h && mtf1h.length > 0) {
            const targetStartTime = formattedData[i].time - 86400;
            for (let k = mtf1h.length - 1; k >= 0; k--) {
                const hb = mtf1h[k];
                if (hb.time + 3600 <= targetStartTime) break;
                if (hb.time < formattedData[0].time) {
                    if (hb.high > hi24) hi24 = hb.high;
                    if (hb.low < lo24) lo24 = hb.low;
                }
            }
        }

        const range24 = Math.max(1e-9, hi24 - lo24);
        const pos24 = rawSig === 1
            ? (currentTick.close - lo24) / range24
            : (hi24 - currentTick.close) / range24;

        // 1. pos24 Filter Rejection Sub-marker
        if (pos24 < 0.67) {
            markers.push({
                time: currentTick.time,
                position: rawSig === 1 ? 'belowBar' : 'aboveBar',
                color: '#f59e0b', // Amber/orange circle
                shape: 'circle',
                text: `F7 Fltr (${(pos24 * 100).toFixed(0)}%)`,
                size: 0.8
            });
            continue;
        }

        // 2. Cooldown Active Sub-marker
        if (i < cooldownUntilIdx) {
            markers.push({
                time: currentTick.time,
                position: rawSig === 1 ? 'belowBar' : 'aboveBar',
                color: '#a855f7', // Purple circle
                shape: 'circle',
                text: 'F7 CD',
                size: 0.8
            });
            continue;
        }

        // 3. Approved Entry Signal
        markers.push({
            time: currentTick.time,
            position: rawSig === 1 ? 'belowBar' : 'aboveBar',
            color: rawSig === 1 ? '#10b981' : '#f43f5e',
            shape: rawSig === 1 ? 'arrowUp' : 'arrowDown',
            text: rawSig === 1 ? `F7 LONG (${sigE !== 0 ? 'E' : 'G'})` : `F7 SHORT (${sigE !== 0 ? 'E' : 'G'})`,
            size: 2
        });

        cooldownUntilIdx = i + 720;
    }

    return markers;
}
