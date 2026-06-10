const fs = require('fs');

function calculateRSI(closes, period = 14) {
    const len = closes.length;
    const rsi = new Array(len).fill(null);
    if (len < period + 1) return rsi;
    
    let avgGain = 0;
    let avgLoss = 0;
    
    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) {
            avgGain += change;
        } else {
            avgLoss += Math.abs(change);
        }
    }
    avgGain /= period;
    avgLoss /= period;
    
    rsi[period] = avgLoss === 0 ? 100 : (avgGain === 0 ? 0 : 100 - (100 / (1 + avgGain / avgLoss)));
    
    for (let i = period + 1; i < len; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        
        rsi[i] = avgLoss === 0 ? 100 : (avgGain === 0 ? 0 : 100 - (100 / (1 + avgGain / avgLoss)));
    }
    return rsi;
}

function calculateStochRSI(klines, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
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
            if (rsi[j] === null) { valid = false; break; }
            if (rsi[j] < lowestRSI) lowestRSI = rsi[j];
            if (rsi[j] > highestRSI) highestRSI = rsi[j];
        }
        if (!valid) continue;
        if (highestRSI === lowestRSI) { stochRsiRaw[i] = 0; }
        else { stochRsiRaw[i] = 100 * (rsi[i] - lowestRSI) / (highestRSI - lowestRSI); }
    }
    const kLine = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
        if (i < rsiPeriod + stochPeriod - 1 + kPeriod - 1) continue;
        let sum = 0; let valid = true;
        for (let j = i - kPeriod + 1; j <= i; j++) {
            if (stochRsiRaw[j] === null) { valid = false; break; }
            sum += stochRsiRaw[j];
        }
        if (valid) { kLine[i] = sum / kPeriod; }
    }
    const dLine = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
        if (i < rsiPeriod + stochPeriod - 1 + kPeriod - 1 + dPeriod - 1) continue;
        let sum = 0; let valid = true;
        for (let j = i - dPeriod + 1; j <= i; j++) {
            if (kLine[j] === null) { valid = false; break; }
            sum += kLine[j];
        }
        if (valid) { dLine[i] = sum / dPeriod; }
    }
    return { kLine, dLine };
}

const https = require('https');
https.get('https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&limit=1000', (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const klinesRaw = JSON.parse(data);
        const history = klinesRaw.map(d => ({
            time: Math.floor(d[0]/1000), open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4])
        }));
        
        // Filter history as if we are at different times around 07:30
        for (let h = 0; h <= 2; h++) {
            let cutoffTime = new Date('2026-06-10T07:14:59+09:00').getTime() / 1000 - 9*3600;
            if(h==1) cutoffTime = new Date('2026-06-10T07:29:59+09:00').getTime() / 1000 - 9*3600;
            if(h==2) cutoffTime = new Date('2026-06-10T07:44:59+09:00').getTime() / 1000 - 9*3600;
            
            const histSlice = history.filter(d => d.time <= cutoffTime);
            
            // aggregateKlines logic
            const interval = 900;
            const grouped = {};
            for (const tick of histSlice) {
                const key = Math.floor(tick.time / interval) * interval;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(tick);
            }
            const aggregated = [];
            const keys = Object.keys(grouped).map(Number).sort((a,b)=>a-b);
            for(const key of keys){
                const group = grouped[key];
                aggregated.push({ time: key, close: group[group.length-1].close });
            }
            
            const res = calculateStochRSI(aggregated);
            const k = res.kLine;
            const d = res.dLine;
            
            console.log(`\nAt cutoff: ${new Date((cutoffTime+9*3600)*1000).toISOString()}`);
            for(let i=1; i<aggregated.length; i++) {
                const timeDate = new Date(aggregated[i].time * 1000 + 9 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 19);
                if(timeDate.startsWith('2026-06-10 07:')) {
                    const prevK = k[i-1];
                    const prevD = d[i-1];
                    const currK = k[i];
                    const currD = d[i];
                    let sig = '';
                    if(prevK < prevD && currK > currD && (currK <= 20 || currD <= 20)) sig = 'LONG';
                    if(prevK > prevD && currK < currD && (currK >= 80 || currD >= 80)) sig = 'SHORT';
                    console.log(`Candle ${timeDate} | k: ${currK?.toFixed(2)} | d: ${currD?.toFixed(2)} | prev_k: ${prevK?.toFixed(2)} | prev_d: ${prevD?.toFixed(2)} | SIG: ${sig}`);
                }
            }
        }
    });
});
