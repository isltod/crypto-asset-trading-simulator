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

module.exports = {
    calculateEMA,
    calculateWaveTrend,
    aggregateKlines,
    calculateMACDForKlines,
    calculateRSI,
    calculateStochRSI,
    calculateVWAPClimax
};
