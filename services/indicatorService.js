function calculateEMA(values, period) {
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

function calculateWaveTrend(formattedData, n1, n2, sigLen) {
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
            wt1Data.push(undefined);
            wt2Data.push(undefined);
        } else {
            wt1Data.push(wt1[i]);
            wt2Data.push(wt2[i]);
        }
    }
    
    return { wt1Data, wt2Data };
}

function aggregateKlines(history, timeframe, symbol = null, klineHistoriesMTF = null) {
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

    if (symbol && timeframe !== '1m' && klineHistoriesMTF && klineHistoriesMTF[symbol] && klineHistoriesMTF[symbol][timeframe]) {
        const mtfHistory = klineHistoriesMTF[symbol][timeframe];
        const firstAggTime = aggregated.length > 0 ? aggregated[0].time : Infinity;
        const merged = mtfHistory.filter(k => k.time < firstAggTime);
        return merged.concat(aggregated);
    }

    return aggregated;
}

function calculateVWAPClimax(klines, window = 96, sigma = 2.0, volLookback = 30, volMult = 1.8, wickRatio = 0.8) {
    const len = klines.length;
    const vwapData = [];
    const upperBandData = [];
    const lowerBandData = [];
    const signals = new Array(len).fill(0);

    if (len === 0) {
        return { vwapData, upperBandData, lowerBandData, signals };
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
        if (currentVolLookback >= 3) {
            let sumVolMA = 0;
            for (let j = i - currentVolLookback + 1; j <= i; j++) {
                sumVolMA += volumes[j];
            }
            const volMA = sumVolMA / currentVolLookback;
            const volRatio = volumes[i] / (volMA + 1e-8);

            const open = klines[i].open;
            const close = klines[i].close;
            const high = klines[i].high;
            const low = klines[i].low;

            const body = Math.abs(close - open);
            const lowerWick = Math.min(open, close) - low;
            const upperWick = high - Math.max(open, close);

            // Long condition
            if (close < lowerVal && volRatio >= volMult && lowerWick >= body * wickRatio) {
                signals[i] = 1;
            }
            // Short condition
            else if (close > upperVal && volRatio >= volMult && upperWick >= body * wickRatio) {
                signals[i] = -1;
            }
        }
    }

    return { vwapData, upperBandData, lowerBandData, signals };
}

function calculateMACDForKlines(klines, fast, slow, sig) {
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

function calculateRSI(closes, period = 14) {
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
        } else {
            const rs = avgGain / avgLoss;
            rsi[i] = 100 - (100 / (1 + rs));
        }
    }
    return rsi;
}

function calculateStochRSI(closes, rsiLen = 14, stochLen = 14, kPeriod = 3, dPeriod = 3) {
    const rsiValues = calculateRSI(closes, rsiLen);
    const len = closes.length;
    const kArray = new Array(len).fill(null);
    const dArray = new Array(len).fill(null);
    
    const rawStoch = new Array(len).fill(null);
    for (let i = rsiLen + stochLen - 1; i < len; i++) {
        const slice = rsiValues.slice(i - stochLen + 1, i + 1);
        const minRsi = Math.min(...slice);
        const maxRsi = Math.max(...slice);
        if (maxRsi === minRsi) {
            rawStoch[i] = 0;
        } else {
            rawStoch[i] = ((rsiValues[i] - minRsi) / (maxRsi - minRsi)) * 100;
        }
    }
    
    for (let i = rsiLen + stochLen + kPeriod - 2; i < len; i++) {
        const slice = rawStoch.slice(i - kPeriod + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        kArray[i] = sum / kPeriod;
    }
    
    for (let i = rsiLen + stochLen + kPeriod + dPeriod - 3; i < len; i++) {
        const slice = kArray.slice(i - dPeriod + 1, i + 1);
        const sum = slice.reduce((a, b) => a + b, 0);
        dArray[i] = sum / dPeriod;
    }
    
    return { k: kArray, d: dArray };
}

function calculateExtremeBreakout(klines) {
    const len = klines.length;
    if (len < 60) return 'HOLD'; // Minimum required history

    // Calculate 24h (1440m) average 1m volume
    const lookback24h = Math.min(len, 1440);
    let sumVol24h = 0;
    for (let i = len - lookback24h; i < len; i++) {
        sumVol24h += klines[i].volume || 0;
    }
    const avg24h1mVol = sumVol24h / lookback24h;

    function getSignalAt(idx) {
        if (idx < 15) return 0;
        const curr = klines[idx].close;
        const past = klines[idx - 15].close;
        const ret15 = ((curr - past) / (past + 1e-9)) * 100;

        let vol15 = 0;
        for (let j = idx - 14; j <= idx; j++) {
            vol15 += klines[j].volume || 0;
        }
        const volSurge = vol15 / (avg24h1mVol * 15 + 1e-9);

        let totalPath = 0;
        for (let j = idx - 14; j <= idx; j++) {
            totalPath += Math.abs(klines[j].close - klines[j - 1].close);
        }
        const netChange = Math.abs(curr - past);
        const er = netChange / (totalPath + 1e-9);

        if (volSurge >= 2.5 && er >= 0.45) {
            if (ret15 >= 0.7) return 1;   // LONG
            if (ret15 <= -0.7) return -1; // SHORT
        }
        return 0;
    }

    const currentIdx = len - 1;
    const currentSig = getSignalAt(currentIdx);
    if (currentSig === 0) return 'HOLD';

    // A1 Filter: Exclude if previous signal run length >= 5 bars
    // 1. Find start of current signal run
    let runStart = currentIdx;
    while (runStart > 0 && getSignalAt(runStart - 1) !== 0) {
        runStart--;
    }

    // 2. Scan backwards to find previous completed signal run
    let p = runStart - 1;
    while (p >= 15 && getSignalAt(p) === 0) {
        p--;
    }

    if (p >= 15) {
        const prevRunEnd = p;
        while (p > 15 && getSignalAt(p - 1) !== 0) {
            p--;
        }
        const prevRunStart = p;
        const prevRunLen = prevRunEnd - prevRunStart + 1;
        if (prevRunLen >= 5) {
            console.log(`[ExtremeBreakout] A1 filter triggered: previous run length was ${prevRunLen} bars (>= 5). Skipping entry.`);
            return 'HOLD';
        }
    }

    return currentSig === 1 ? 'LONG' : 'SHORT';
}

function calculateFork7Candidate3(klines) {
    if (!klines || klines.length < 1440) return 'HOLD';

    const len = klines.length;
    const currentTick = klines[len - 1];
    const prevTick = klines[len - 2];

    // 1. Group klines into hourly bars to get 24-hour OLS Regression
    const hourlyBars = [];
    let curHKey = null;
    let hHigh = -Infinity, hLow = Infinity, hiMin = 0, loMin = 0;

    const currentHourKey = Math.floor(currentTick.time / 3600) * 3600;

    for (let i = 0; i < len; i++) {
        const k = klines[i];
        const hKey = Math.floor(k.time / 3600) * 3600;
        if (hKey === currentHourKey) continue; // Only take completed hours before current hour

        if (curHKey === null || hKey !== curHKey) {
            if (curHKey !== null) {
                hourlyBars.push({ hKey: curHKey, high: hHigh, low: hLow, hiMin, loMin });
            }
            curHKey = hKey;
            hHigh = k.high;
            hLow = k.low;
            hiMin = Math.floor((k.time % 3600) / 60);
            loMin = hiMin;
        } else {
            const m = Math.floor((k.time % 3600) / 60);
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
    if (curHKey !== null) {
        hourlyBars.push({ hKey: curHKey, high: hHigh, low: hLow, hiMin, loMin });
    }

    if (hourlyBars.length < 24) return 'HOLD';
    const last24Hours = hourlyBars.slice(-24);

    // OLS Linear Regression for Highs and Lows over 24 hours
    let sumX_hi = 0, sumY_hi = 0, sumX_lo = 0, sumY_lo = 0;
    const ptsHi = [], ptsLo = [];
    for (let i = 0; i < 24; i++) {
        const hb = last24Hours[i];
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

    // Current bar minute in hour
    const curMin = Math.floor((currentTick.time % 3600) / 60);
    const xx_curr = 24 + curMin / 60.0;
    const pred_hi_curr = A0 + A1 * xx_curr;
    const pred_lo_curr = B0 + B1 * xx_curr;
    const zU_curr = (currentTick.close - pred_hi_curr) / sigma_hi;
    const zL_curr = (pred_lo_curr - currentTick.close) / sigma_lo;

    // Prev bar minute in hour
    const prevMin = Math.floor((prevTick.time % 3600) / 60);
    const xx_prev = (Math.floor(prevTick.time / 3600) * 3600 === currentHourKey ? 24 : 23) + prevMin / 60.0;
    const pred_hi_prev = A0 + A1 * xx_prev;
    const pred_lo_prev = B0 + B1 * xx_prev;
    const zU_prev = (prevTick.close - pred_hi_prev) / sigma_hi;
    const zL_prev = (pred_lo_prev - prevTick.close) / sigma_lo;

    // 2. Node E Detection (Band 2.0 sigma transition)
    let sigE = 0;
    if (zU_prev < 2.0 && zU_curr >= 2.0) sigE = 1;
    else if (zL_prev < 2.0 && zL_curr >= 2.0) sigE = -1;

    // 3. Node G Detection (1m volatility / volume explosion)
    const lr_curr = Math.log(currentTick.close / (prevTick.close + 1e-9));
    const lookback = Math.min(len - 1, 1440);
    let sum_lr = 0, sum_sq_lr = 0;
    const vols = [];
    for (let j = len - lookback; j < len; j++) {
        const lr = Math.log(klines[j].close / (klines[j - 1].close + 1e-9));
        sum_lr += lr;
        sum_sq_lr += lr * lr;
        vols.push(klines[j].volume || 0);
    }
    const mean_lr = sum_lr / lookback;
    const var_lr = Math.max(1e-12, sum_sq_lr / lookback - mean_lr * mean_lr);
    const std_lr = Math.sqrt(var_lr);
    const z_ret = (lr_curr - mean_lr) / std_lr;

    // Median and MAD of volume
    vols.sort((a, b) => a - b);
    const midIdx = Math.floor(vols.length / 2);
    const med_vol = vols.length % 2 === 0 ? (vols[midIdx - 1] + vols[midIdx]) / 2 : vols[midIdx];
    const devVols = vols.map(v => Math.abs(v - med_vol)).sort((a, b) => a - b);
    const mad_vol = (devVols.length % 2 === 0 ? (devVols[midIdx - 1] + devVols[midIdx]) / 2 : devVols[midIdx]) * 1.4826 + 1e-9;
    const z_vol = ((currentTick.volume || 0) - med_vol) / mad_vol;

    let sigG = 0;
    if (Math.abs(z_ret) >= 4.0 && z_vol >= 5.0) {
        if (lr_curr > 0 && zU_curr >= 1.0) sigG = 1;
        else if (lr_curr < 0 && zL_curr >= 1.0) sigG = -1;
    }

    // Combine E and G (E takes priority)
    const rawSig = sigE !== 0 ? sigE : sigG;
    if (rawSig === 0) return 'HOLD';

    // 4. pos24 Filter check
    let hi24 = -Infinity, lo24 = Infinity;
    for (let j = len - lookback; j < len; j++) {
        if (klines[j].high > hi24) hi24 = klines[j].high;
        if (klines[j].low < lo24) lo24 = klines[j].low;
    }
    const range24 = Math.max(1e-9, hi24 - lo24);
    const pos24 = rawSig === 1 
        ? (currentTick.close - lo24) / range24 
        : (hi24 - currentTick.close) / range24;

    // Upper 1/3 threshold requirement (pos24 >= 0.67)
    if (pos24 < 0.67) {
        console.log(`[Fork 7] ${rawSig === 1 ? 'LONG' : 'SHORT'} (Node ${sigE !== 0 ? 'E' : 'G'}) pos24=${pos24.toFixed(3)} < 0.67. Filtered out.`);
        return 'HOLD';
    }

    console.log(`[Fork 7] Signal APPROVED: ${rawSig === 1 ? 'LONG' : 'SHORT'} via Node ${sigE !== 0 ? 'E' : 'G'}. pos24=${pos24.toFixed(3)}, zU=${zU_curr.toFixed(2)}, zL=${zL_curr.toFixed(2)}`);
    return rawSig === 1 ? 'LONG' : 'SHORT';
}

module.exports = {
    calculateEMA,
    calculateWaveTrend,
    aggregateKlines,
    calculateMACDForKlines,
    calculateRSI,
    calculateStochRSI,
    calculateVWAPClimax,
    calculateExtremeBreakout,
    calculateFork7Candidate3
};
