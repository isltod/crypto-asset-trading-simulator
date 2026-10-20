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

function calculateFork13Trinity(klines, currentPosSide = null) {
    if (!klines || klines.length < 1441) return { signal: 'HOLD', reason: 'INSUFFICIENT_DATA' };

    const len = klines.length;
    const currentTick = klines[len - 1];
    const prevTick = klines[len - 2];
    const currentHourKey = Math.floor(currentTick.time / 3600) * 3600;

    // 1. Group klines into completed hourly bars
    const hourlyBars = [];
    let curHKey = null;
    let hHigh = -Infinity, hLow = Infinity, hiMin = 0, loMin = 0;

    for (let i = 0; i < len; i++) {
        const k = klines[i];
        const hKey = Math.floor(k.time / 3600) * 3600;
        if (hKey === currentHourKey) continue; // completed hours only

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

    if (hourlyBars.length < 24) return { signal: 'HOLD', reason: 'NEED_24_HOURS' };
    const last24Hours = hourlyBars.slice(-24);

    // 2. 24h OLS Regression on Highs and Lows
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

    const curMin = Math.floor((currentTick.time % 3600) / 60);
    function getBandAtOffset(minuteOffset, price) {
        const x = 24.0 + (curMin + minuteOffset) / 60.0;
        const upper = A0 + A1 * x;
        const lower = B0 + B1 * x;
        const zU = (price - upper) / sigma_hi;
        const zL = (lower - price) / sigma_lo;
        const bw = (upper - lower) / price * 100.0;
        return { upper, lower, zU, zL, bw };
    }

    const bandCurr = getBandAtOffset(0, currentTick.close);
    const bandM3 = getBandAtOffset(-3, klines[len - 4] ? klines[len - 4].close : currentTick.close);
    const bandM60 = getBandAtOffset(-60, klines[len - 61] ? klines[len - 61].close : currentTick.close);

    // 3. Realized 24h Volatility (past 1440 1m log returns)
    let sum_lr = 0, sum_sq_lr = 0;
    const lookback = 1440;
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
    const vol_24h = std_lr * Math.sqrt(1440) * 100.0;

    // 4. Climax Take-Profit check for SHORT
    if (currentPosSide === 'SHORT') {
        if (bandCurr.zL >= 4.0 && vol_24h >= 2.5) {
            console.log(`[Fork 13] SHORT Climax Take-Profit Triggered! zL=${bandCurr.zL.toFixed(2)} >= 4.0, vol_24h=${vol_24h.toFixed(2)}% >= 2.5%`);
            return {
                signal: 'FLAT',
                action: 'CLIMAX_TP',
                reason: 'CLIMAX_TAKE_PROFIT',
                size: 1.0,
                bw: bandCurr.bw,
                zU: bandCurr.zU,
                zL: bandCurr.zL,
                vol_24h
            };
        }
    }

    // 5. Node G Detection at current bar
    const lr_curr = Math.log(currentTick.close / (prevTick.close + 1e-9));
    const z_ret = (lr_curr - mean_lr) / std_lr;

    vols.sort((a, b) => a - b);
    const midIdx = Math.floor(vols.length / 2);
    const med_vol = vols.length % 2 === 0 ? (vols[midIdx - 1] + vols[midIdx]) / 2 : vols[midIdx];
    const devVols = vols.map(v => Math.abs(v - med_vol)).sort((a, b) => a - b);
    const mad_vol = (devVols.length % 2 === 0 ? (devVols[midIdx - 1] + devVols[midIdx]) / 2 : devVols[midIdx]) * 1.4826 + 1e-9;
    const z_vol = ((currentTick.volume || 0) - med_vol) / mad_vol;

    const zb_curr_g = lr_curr >= 0 ? bandCurr.zU : bandCurr.zL;
    const isNodeGFired = Math.abs(z_ret) >= 4.0 && z_vol >= 5.0 && zb_curr_g >= 1.0;
    const dirG = lr_curr >= 0 ? 1 : -1;

    // 6. Node C Detection at current bar (15m momentum)
    const t0 = len - 1;
    const t15 = len - 16;
    const ret15 = (currentTick.close - klines[t15].close) / klines[t15].close * 100.0;
    let vol15Sum = 0;
    let diff1mSum = 0;
    for (let j = t15 + 1; j <= t0; j++) {
        vol15Sum += klines[j].volume || 0;
        diff1mSum += Math.abs(klines[j].close - klines[j - 1].close);
    }
    const meanVol24h = vols.reduce((a, b) => a + b, 0) / lookback;
    const vol15Ratio = vol15Sum / (meanVol24h * 15.0 + 1e-12);
    const er15 = Math.abs(currentTick.close - klines[t15].close) / (diff1mSum + 1e-9);

    const isNodeCFired = Math.abs(ret15) >= 0.7 && vol15Ratio >= 2.5 && er15 >= 0.45;
    const dirC = ret15 >= 0 ? 1 : -1;

    // Segment start checks
    function checkNodeGSegmentStart() {
        if (!isNodeGFired) return false;
        for (let p = len - 2; p >= Math.max(1440, len - 180); p--) {
            const p_lr = Math.log(klines[p].close / (klines[p - 1].close + 1e-9));
            const p_zret = (p_lr - mean_lr) / std_lr;
            const p_zvol = ((klines[p].volume || 0) - med_vol) / mad_vol;
            const p_band = getBandAtOffset(p - (len - 1), klines[p].close);
            const p_zb = p_lr >= 0 ? p_band.zU : p_band.zL;
            if (Math.abs(p_zret) >= 4.0 && p_zvol >= 5.0 && p_zb >= 1.0) {
                const p_dir = p_lr >= 0 ? 1 : -1;
                return p_dir !== dirG;
            }
        }
        return true;
    }

    function checkNodeCSegmentStart() {
        if (!isNodeCFired) return false;
        for (let p = len - 2; p >= Math.max(1440, len - 180); p--) {
            const p_ret15 = (klines[p].close - klines[p - 15].close) / klines[p - 15].close * 100.0;
            let p_vol15 = 0, p_diff = 0;
            for (let j = p - 14; j <= p; j++) {
                p_vol15 += klines[j].volume || 0;
                p_diff += Math.abs(klines[j].close - klines[j - 1].close);
            }
            const p_volRatio = p_vol15 / (meanVol24h * 15.0 + 1e-12);
            const p_er15 = Math.abs(klines[p].close - klines[p - 15].close) / (p_diff + 1e-9);
            if (Math.abs(p_ret15) >= 0.7 && p_volRatio >= 2.5 && p_er15 >= 0.45) {
                const p_dir = p_ret15 >= 0 ? 1 : -1;
                return p_dir !== dirC;
            }
        }
        return true;
    }

    const isGSegStart = checkNodeGSegmentStart();
    const isCSegStart = checkNodeCSegmentStart();

    // 7. Trinity Signal Rules
    const signals = [];
    const bw = bandCurr.bw;

    // A. G_BASE: Normal band [0.40, 0.64] & t-3 already outside band (zb >= 0)
    if (isGSegStart) {
        const normal = bw >= 0.40 && bw <= 0.64;
        const zb_m3 = dirG === 1 ? bandM3.zU : bandM3.zL;
        if (normal && zb_m3 >= 0.0) {
            signals.push({ dir: dirG, type: 'G_BASE' });
        }

        // B. G_REV_LONG: Expansion band (>0.64) & Short & t-3 trapped inside band (zL < 0)
        const wide = bw > 0.64;
        if (wide && dirG === -1 && bandM3.zL < 0.0) {
            signals.push({ dir: 1, type: 'G_REV_LONG' });
        }
    }

    // C. C_BASE: Squeeze (<0.40) with zb >= 2.0 OR Expansion (>0.64) with t-60 outside band (zb >= 0)
    if (isCSegStart) {
        const squeeze = bw < 0.40 && (dirC === 1 ? bandCurr.zU : bandCurr.zL) >= 2.0;
        const trend = bw > 0.64 && (dirC === 1 ? bandM60.zU : bandM60.zL) >= 0.0;
        if (squeeze || trend) {
            signals.push({ dir: dirC, type: 'C_BASE' });
        }
    }

    if (signals.length === 0) {
        return { signal: 'HOLD', bw, zU: bandCurr.zU, zL: bandCurr.zL, vol_24h };
    }

    // Collision check: if directions conflict, discard all
    const dirs = new Set(signals.map(s => s.dir));
    if (dirs.size > 1) {
        console.log(`[Fork 13] Signal COLLISION discarded! Directions: ${[...dirs].join(', ')}`);
        return { signal: 'HOLD', reason: 'COLLISION_DISCARD', bw, vol_24h };
    }

    // Priority: G_BASE > C_BASE > G_REV_LONG
    const priority = { 'G_BASE': 1, 'C_BASE': 2, 'G_REV_LONG': 3 };
    signals.sort((a, b) => priority[a.type] - priority[b.type]);
    const chosen = signals[0];

    // Volatility Sizing: target_vol ~ 2.2% (Train/Validation 30d median benchmark)
    const target_vol = 2.2;
    const size = Math.min(1.0, Math.max(0.4, target_vol / vol_24h));

    console.log(`[Fork 13] Signal APPROVED: ${chosen.dir === 1 ? 'LONG' : 'SHORT'} via ${chosen.type}. Size=${size.toFixed(2)}, BW=${bw.toFixed(3)}%, Vol24h=${vol_24h.toFixed(2)}%`);

    return {
        signal: chosen.dir === 1 ? 'LONG' : 'SHORT',
        signalType: chosen.type,
        size: parseFloat(size.toFixed(2)),
        bw,
        zU: bandCurr.zU,
        zL: bandCurr.zL,
        vol_24h
    };
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
    calculateFork13Trinity,
    calculateFork9DualFirewall,
    calculateFork9DualFirewallOV34: (klines) => calculateFork9DualFirewall(klines, 0.34, true),
    calculateFork9DualFirewallOV28: (klines) => calculateFork9DualFirewall(klines, 0.28, true)
};

/**
 * Fork 9 Track 2: Dual Firewall (Bar Overlap Ratio + Causal Doom Cell Gating)
 * @param {Array} klines 1m kline data
 * @param {number} minOverlap Minimum 24h bar overlap threshold (e.g., 0.34 or 0.28)
 * @param {boolean} blockDoom Whether to block the Doom Cell (top 33% ER & top 33% Overlap)
 */
function calculateFork9DualFirewall(klines, minOverlap = 0.34, blockDoom = true) {
    const len = klines.length;
    if (len < 1441) return 'HOLD';

    const currentTick = klines[len - 1];
    const prevTick = klines[len - 2];

    // 1. Hourly aggregation for 24h OLS bands
    const hourlyBars = [];
    let curHKey = null;
    let hHigh = -Infinity, hLow = Infinity;
    let hiMin = 0, loMin = 0;

    for (let i = 0; i < len; i++) {
        const k = klines[i];
        const hKey = Math.floor(k.time / 3600) * 3600;
        if (hKey !== curHKey) {
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
            if (k.high > hHigh) { hHigh = k.high; hiMin = m; }
            if (k.low < hLow) { hLow = k.low; loMin = m; }
        }
    }
    if (curHKey !== null) {
        hourlyBars.push({ hKey: curHKey, high: hHigh, low: hLow, hiMin, loMin });
    }

    if (hourlyBars.length < 25) return 'HOLD';
    const last24Hours = hourlyBars.slice(-25, -1);

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
        resSum_hi += Math.pow(ptsHi[i].y - (A0 + A1 * ptsHi[i].x), 2);
        resSum_lo += Math.pow(ptsLo[i].y - (B0 + B1 * ptsLo[i].x), 2);
    }
    const sigma_hi = Math.sqrt(resSum_hi / 22) + 1e-9;
    const sigma_lo = Math.sqrt(resSum_lo / 22) + 1e-9;

    const curMin = Math.floor((currentTick.time % 3600) / 60);
    const xx_curr = 24 + curMin / 60.0;
    const zU_curr = (currentTick.close - (A0 + A1 * xx_curr)) / sigma_hi;
    const zL_curr = ((B0 + B1 * xx_curr) - currentTick.close) / sigma_lo;

    // 2. Node G Trigger Check (|z_ret| >= 4.0, z_vol >= 5.0, z_band >= 1.0)
    const lr_curr = Math.log(currentTick.close / (prevTick.close + 1e-9));
    const lookback = 1440;
    let sum_lr = 0, sum_sq_lr = 0;
    const vols = [];
    for (let j = len - lookback; j < len; j++) {
        const lr = Math.log(klines[j].close / (klines[j - 1].close + 1e-9));
        sum_lr += lr;
        sum_sq_lr += lr * lr;
        vols.push(klines[j].volume || 0);
    }
    const mean_lr = sum_lr / lookback;
    const std_lr = Math.sqrt(Math.max(1e-12, sum_sq_lr / lookback - mean_lr * mean_lr));
    const z_ret = (lr_curr - mean_lr) / std_lr;

    vols.sort((a, b) => a - b);
    const midIdx = Math.floor(vols.length / 2);
    const med_vol = vols.length % 2 === 0 ? (vols[midIdx - 1] + vols[midIdx]) / 2 : vols[midIdx];
    const devVols = vols.map(v => Math.abs(v - med_vol)).sort((a, b) => a - b);
    const mad_vol = (devVols.length % 2 === 0 ? (devVols[midIdx - 1] + devVols[midIdx]) / 2 : devVols[midIdx]) * 1.4826 + 1e-9;
    const z_vol = ((currentTick.volume || 0) - med_vol) / mad_vol;

    let rawSig = 0;
    if (Math.abs(z_ret) >= 4.0 && z_vol >= 5.0) {
        if (lr_curr > 0 && zU_curr >= 1.0) rawSig = 1;
        else if (lr_curr < 0 && zL_curr >= 1.0) rawSig = -1;
    }

    if (rawSig === 0) return 'HOLD';

    // 3. Firewall 1: 24h Bar Overlap Ratio
    let sumOv = 0;
    for (let j = len - lookback; j < len; j++) {
        const p = klines[j - 1];
        const c = klines[j];
        const inter = Math.max(0, Math.min(c.high, p.high) - Math.max(c.low, p.low));
        const union = Math.max(1e-6, Math.max(c.high, p.high) - Math.min(c.low, p.low));
        sumOv += (inter / union);
    }
    const currOverlap = sumOv / lookback;

    if (minOverlap !== null && currOverlap < minOverlap) {
        console.log(`[Fork 9 Dual Firewall] ${rawSig === 1 ? 'LONG' : 'SHORT'} Node G rejected: Overlap24h ${currOverlap.toFixed(4)} < ${minOverlap}`);
        return 'HOLD';
    }

    // 4. Firewall 2: Causal Doom Cell Gating (ER Top 33% AND Overlap Top 33%)
    if (blockDoom) {
        let path = 0;
        for (let j = len - lookback; j < len; j++) {
            path += Math.abs(klines[j].close - klines[j - 1].close);
        }
        const disp = Math.abs(currentTick.close - klines[len - lookback].close);
        const currER = path > 0 ? disp / path : 0.0;

        // Sample historical 24h ER and Overlap over available bars (up to 30 days)
        const histWindow = Math.min(len - 1440, 30 * 1440);
        if (histWindow >= 1440) {
            const erHist = [];
            const ovHist = [];
            const step = 15;
            for (let idx = len - histWindow; idx < len; idx += step) {
                let p_sub = 0;
                let ov_sub = 0;
                for (let k = idx - 1440; k < idx; k++) {
                    p_sub += Math.abs(klines[k].close - klines[k - 1].close);
                    const inter_s = Math.max(0, Math.min(klines[k].high, klines[k - 1].high) - Math.max(klines[k].low, klines[k - 1].low));
                    const union_s = Math.max(1e-6, Math.max(klines[k].high, klines[k - 1].high) - Math.min(klines[k].low, klines[k - 1].low));
                    ov_sub += (inter_s / union_s);
                }
                const d_sub = Math.abs(klines[idx].close - klines[idx - 1440].close);
                erHist.push(p_sub > 0 ? d_sub / p_sub : 0.0);
                ovHist.push(ov_sub / 1440);
            }

            erHist.sort((a, b) => a - b);
            ovHist.sort((a, b) => a - b);
            const qIdx = Math.floor(erHist.length * 0.6667);
            const qER = erHist[qIdx] || 0.05;
            const qOV = ovHist[qIdx] || 0.35;

            if (currER > qER && currOverlap > qOV) {
                console.log(`[Fork 9 Dual Firewall] ${rawSig === 1 ? 'LONG' : 'SHORT'} Node G rejected by DOOM CELL: ER=${currER.toFixed(4)} > ${qER.toFixed(4)} AND Overlap=${currOverlap.toFixed(4)} > ${qOV.toFixed(4)}`);
                return 'HOLD';
            }
        }
    }

    const dirStr = rawSig === 1 ? 'LONG' : 'SHORT';
    console.log(`[Fork 9 Dual Firewall (minOV=${minOverlap})] Signal APPROVED: ${dirStr}. Overlap24h=${currOverlap.toFixed(4)}, z_ret=${z_ret.toFixed(2)}, z_vol=${z_vol.toFixed(2)}`);
    return dirStr;
}
