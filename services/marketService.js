const https = require('https');

const SYMBOLS_TO_STREAM = ['btcusdt', 'ethusdt', 'solusdt', 'xrpusdt', 'bnbusdt'];

const latestPrices = {};
const klineHistories = {};
const klineHistoriesMTF = {};
let lastBinanceMessageTime = 0;
let binanceStatus = "connecting";
let binanceError = null;

function getJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (err) => reject(err));
    });
}

async function initKlineHistories() {
    await Promise.all(SYMBOLS_TO_STREAM.map(async (rawSymbol) => {
        const symbol = rawSymbol.toUpperCase();
        klineHistoriesMTF[symbol] = {};

        let combinedData = [];
        let endTime = null;
        for (let c = 0; c < 5; c++) {
            let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1000`;
            if (endTime) url += `&endTime=${endTime}`;
            try {
                const chunk = await getJson(url);
                if (!Array.isArray(chunk) || chunk.length === 0) break;
                combinedData = chunk.concat(combinedData);
                endTime = chunk[0][0] - 1;
            } catch (eChunk) {
                console.error(`[Init] Failed to load 1m chunk ${c + 1} for ${symbol}:`, eChunk.message);
                break;
            }
        }

        try {
            klineHistories[symbol] = combinedData.map(d => ({
                time: Math.floor(d[0] / 1000),
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4]),
                volume: parseFloat(d[5]) || 0
            }));
            console.log(`[Init] Loaded ${klineHistories[symbol].length} klines for ${symbol}`);
        } catch (e) {
            console.error(`[Init] Failed to load klines for ${symbol}:`, e.message);
            klineHistories[symbol] = [];
        }

        const mtfList = ['3m', '5m', '15m', '30m', '1h', '4h', '1d'];
        for (const tf of mtfList) {
            const mtfUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=1000`;
            try {
                const data = await getJson(mtfUrl);
                klineHistoriesMTF[symbol][tf] = data.map(d => ({
                    time: Math.floor(d[0] / 1000),
                    open: parseFloat(d[1]),
                    high: parseFloat(d[2]),
                    low: parseFloat(d[3]),
                    close: parseFloat(d[4]),
                    volume: parseFloat(d[5]) || 0
                }));
            } catch (e) {
                console.error(`[Init] Failed to load ${tf} klines for ${symbol}:`, e.message);
                klineHistoriesMTF[symbol][tf] = [];
            }
        }
    }));
}

function updateKlineTick(symbol, message) {
    lastBinanceMessageTime = Date.now();
    const currentPrice = parseFloat(message.k.c);
    const tickVolume = parseFloat(message.k.v) || 0;
    latestPrices[symbol] = currentPrice;

    if (klineHistories[symbol]) {
        const tick = {
            time: Math.floor(message.k.t / 1000),
            open: parseFloat(message.k.o),
            high: parseFloat(message.k.h),
            low: parseFloat(message.k.l),
            close: currentPrice,
            volume: tickVolume
        };
        const history = klineHistories[symbol];
        const lastIdx = history.length - 1;
        if (lastIdx >= 0 && history[lastIdx].time === tick.time) {
            history[lastIdx] = tick;
        } else {
            history.push(tick);
            if (history.length > 5000) {
                history.shift();
            }
        }

        if (klineHistoriesMTF[symbol]) {
            const tfMap = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
            for (const tf in klineHistoriesMTF[symbol]) {
                const interval = tfMap[tf];
                if (!interval) continue;
                const mtfHistory = klineHistoriesMTF[symbol][tf];
                const key = Math.floor(tick.time / interval) * interval;
                const mtfLastIdx = mtfHistory.length - 1;
                
                if (mtfLastIdx >= 0 && mtfHistory[mtfLastIdx].time === key) {
                    const currentMtf = mtfHistory[mtfLastIdx];
                    currentMtf.high = Math.max(currentMtf.high, tick.high);
                    currentMtf.low = Math.min(currentMtf.low, tick.low);
                    currentMtf.close = tick.close;
                    currentMtf.volume = (currentMtf.volume || 0) + tickVolume;
                } else {
                    mtfHistory.push({
                        time: key,
                        open: tick.open,
                        high: tick.high,
                        low: tick.low,
                        close: tick.close,
                        volume: tickVolume
                    });
                    if (mtfHistory.length > 1000) {
                        mtfHistory.shift();
                    }
                }
            }
        }
    }
    return currentPrice;
}

function setBinanceStatus(status, error = null) {
    binanceStatus = status;
    binanceError = error;
}

function getBinanceState() {
    return {
        status: binanceStatus,
        lastMessageTime: lastBinanceMessageTime,
        error: binanceError
    };
}

module.exports = {
    SYMBOLS_TO_STREAM,
    latestPrices,
    klineHistories,
    klineHistoriesMTF,
    getJson,
    initKlineHistories,
    updateKlineTick,
    setBinanceStatus,
    getBinanceState
};
