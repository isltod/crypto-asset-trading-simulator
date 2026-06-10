// API Endpoints
const basePath = window.location.pathname.replace(/\/$/, '');
const API_URL = basePath + '/api';
const WS_URL = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + window.location.pathname;
const BINANCE_REST_URL = API_URL + '/proxy'; // Proxy via backend

// DOM Elements
const symbolSelect = document.getElementById('symbol-select');
const chartContainer = document.getElementById('chart-container');
const currentPriceEl = document.getElementById('current-price');
const priceChangeEl = document.getElementById('price-change');
const btnLong = document.getElementById('btn-long');
const btnShort = document.getElementById('btn-short');
const btnClose = document.getElementById('btn-close');
const activePosInfo = document.getElementById('active-position-info');
const posSymbolEl = document.getElementById('pos-symbol');
const posSideEl = document.getElementById('pos-side');
const posEntryTypeEl = document.getElementById('pos-entry-type');
const posEntryTimeEl = document.getElementById('pos-entry-time');
const posEntryEl = document.getElementById('pos-entry');
const posMarginEl = document.getElementById('pos-margin');
const posSizeEl = document.getElementById('pos-size');
const posPnlEl = document.getElementById('pos-pnl');
const posRoeEl = document.getElementById('pos-roe');
const btnHistory = document.getElementById('btn-history');
const historyModal = document.getElementById('history-modal');
const btnCloseHistory = document.getElementById('btn-close-history');
const historyTbody = document.getElementById('history-tbody');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnClearHistory = document.getElementById('btn-clear-history');
const confirmModal = document.getElementById('confirm-modal');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const btnConfirmOk = document.getElementById('btn-confirm-ok');

// Auth DOM
const btnOpenLogin = document.getElementById('btn-open-login');
const btnLogout = document.getElementById('btn-logout');
const authModal = document.getElementById('auth-modal');
const btnCloseAuth = document.getElementById('btn-close-auth');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const userDisplay = document.getElementById('user-display');
const authToggleLink = document.getElementById('auth-toggle-link');
const authTitle = document.getElementById('auth-title');
const btnRecharge = document.getElementById('btn-recharge');

// Auto Trading DOM
const signalSelect = document.getElementById('signal-select');
const toggleAutoTrade = document.getElementById('toggle-autotrade');
const botStateBadge = document.getElementById('bot-state-badge');

// Mobile UI DOM
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const headerControls = document.getElementById('header-controls');
const authControls = document.getElementById('auth-controls');
const mobileTradeBtn = document.getElementById('mobile-trade-btn');
const tradePanel = document.getElementById('trade-panel');

// State
let authToken = localStorage.getItem('cats_token');
let currentUsername = localStorage.getItem('cats_username');
let isLoginMode = true;

let currentSymbol = 'BTCUSDT';
let chart = null;
let candleSeries = null;
let maSeries = null;
let bbUpperSeries = null;
let bbLowerSeries = null;
let bbMiddleSeries = null;
let ws = null;
let lastClose = 0;
let maPeriod = 20;
let lastHB = Date.now();

// Auto Trading State
let autoTradeEnabled = false;
let signalType = 'none';

// WaveTrend State & Constants
let wtChart = null;
let wt1Series = null;
let wt2Series = null;
let WT_CHANNEL_LEN = 10;
let WT_AVG_LEN = 21;
let WT_SIG_LEN = 4;
let WT_OB_LEVEL = 53;
let wtPriceLines = [];

// Supertrend State & Constants
let supertrendSeriesList = [];
let supertrendPeriod = 10;
let supertrendMultiplier = 3.0;

// MACD State & Constants
let macdChart = null;
let macdLineSeries = null;
let macdSigSeries = null;
let macdHistSeries = null;
let MACD_TF = '5m';
let MACD_FAST = 12;
let MACD_SLOW = 26;
let MACD_SIG = 9;
let MACD_ALLOW_REPAINT = false;

// StochRSI State & Constants
let stochRsiChart = null;
let stochRsiKSeries = null;
let stochRsiDSeries = null;
let STOCH_TF = '5m';
let STOCH_RSI_LEN = 14;
let STOCH_LEN = 14;
let STOCH_K = 3;
let STOCH_D = 3;
let STOCH_ALLOW_REPAINT = false;
let stochPriceLines = [];

// Helper functions for indicators
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

function calculateWaveTrend(formattedData, n1 = WT_CHANNEL_LEN, n2 = WT_AVG_LEN, sigLen = WT_SIG_LEN) {
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

    // wt2 = sma(wt1, sigLen)
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

function aggregateKlines(history, timeframe) {
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

function calculateMTFMacd(formattedData, tf = MACD_TF, fast = MACD_FAST, slow = MACD_SLOW, sig = MACD_SIG, allowRepaint = MACD_ALLOW_REPAINT) {
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

        // To prevent repainting, use the completed candle (aggIdx - 1) for higher timeframes
        const is1m = tf === '1m';
        const useIdx = (is1m || allowRepaint) ? aggIdx : aggIdx - 1;
        const currentAgg = useIdx >= 0 ? aggregated[useIdx] : null;

        if (currentAgg) {
            const mVal = macdResult.macdLine[useIdx];
            const sVal = macdResult.signalLine[useIdx];
            const hVal = macdResult.hist[useIdx];

            let color = '#26a69a'; // green
            if (hVal < 0) color = '#ef5350'; // red

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

function calculateMTFStochRSI(formattedData, tf = STOCH_TF, rsiPeriod = STOCH_RSI_LEN, stochPeriod = STOCH_LEN, kPeriod = STOCH_K, dPeriod = STOCH_D, allowRepaint = STOCH_ALLOW_REPAINT) {
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


function applyIndicatorMarkers() {
    const toggleWT = document.getElementById('toggle-wt');
    const toggleMACD = document.getElementById('toggle-macd');
    if (!candleSeries) return;

    const formattedData = window.klineData;
    if (!formattedData || formattedData.length === 0) return;

    const markers = [];
    const len = formattedData.length;

    // 1. WaveTrend Markers
    if (toggleWT && toggleWT.checked && window.lastWtData && window.lastWtData.wt1Data && window.lastWtData.wt2Data) {
        const wtData = window.lastWtData;
        const wtMarkers = [];
        for (let i = 1; i < len; i++) {
            const prevWt1 = wtData.wt1Data[i - 1].value;
            const prevWt2 = wtData.wt2Data[i - 1].value;
            const currWt1 = wtData.wt1Data[i].value;
            const currWt2 = wtData.wt2Data[i].value;

            if (prevWt1 === undefined || prevWt2 === undefined || currWt1 === undefined || currWt2 === undefined) {
                continue;
            }

            const time = formattedData[i].time;

            if (prevWt1 < prevWt2 && currWt1 > currWt2 && currWt1 < -WT_OB_LEVEL) {
                markers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#2ebd85',
                    shape: 'arrowUp',
                    text: 'LONG',
                    size: 1
                });
                wtMarkers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#2ebd85',
                    shape: 'circle',
                    text: 'L',
                    size: 1
                });
            } else if (prevWt1 > prevWt2 && currWt1 < currWt2 && currWt1 > WT_OB_LEVEL) {
                markers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#f6465d',
                    shape: 'arrowDown',
                    text: 'SHORT',
                    size: 1
                });
                wtMarkers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#f6465d',
                    shape: 'circle',
                    text: 'S',
                    size: 1
                });
            }
        }
        if (wt1Series) wt1Series.setMarkers(wtMarkers);
    } else {
        if (wt1Series) wt1Series.setMarkers([]);
    }

    // 2. MACD Markers
    if (toggleMACD && toggleMACD.checked && window.lastMacdData && window.lastMacdData.macdData && window.lastMacdData.sigData) {
        const macdData = window.lastMacdData;
        const macdMarkers = [];
        for (let i = 1; i < len; i++) {
            const prevM = macdData.macdData[i - 1].value;
            const prevS = macdData.sigData[i - 1].value;
            const currM = macdData.macdData[i].value;
            const currS = macdData.sigData[i].value;

            if (prevM === undefined || prevS === undefined || currM === undefined || currS === undefined) {
                continue;
            }

            const time = formattedData[i].time;

            if (prevM < prevS && currM > currS) {
                markers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#38bdf8',
                    shape: 'arrowUp',
                    text: 'MACD LONG',
                    size: 1
                });
                macdMarkers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#38bdf8',
                    shape: 'circle',
                    text: 'L',
                    size: 1
                });
            } else if (prevM > prevS && currM < currS) {
                markers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#fb923c',
                    shape: 'arrowDown',
                    text: 'MACD SHORT',
                    size: 1
                });
                macdMarkers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#fb923c',
                    shape: 'circle',
                    text: 'S',
                    size: 1
                });
            }
        }
        if (macdLineSeries) macdLineSeries.setMarkers(macdMarkers);
    } else {
        if (macdLineSeries) macdLineSeries.setMarkers([]);
    }

    // 3. StochRSI Markers
    const toggleStoch = document.getElementById('toggle-stoch-rsi');
    if (toggleStoch && toggleStoch.checked && window.lastStochData && window.lastStochData.kData && window.lastStochData.dData) {
        const stochData = window.lastStochData;
        const stochMarkers = [];
        for (let i = 1; i < len; i++) {
            const prevK = stochData.kData[i - 1].value;
            const prevD = stochData.dData[i - 1].value;
            const currK = stochData.kData[i].value;
            const currD = stochData.dData[i].value;

            if (prevK === undefined || prevD === undefined || currK === undefined || currD === undefined ||
                prevK === null || prevD === null || currK === null || currD === null) {
                continue;
            }

            const time = formattedData[i].time;

            if (prevK < prevD && currK > currD && (currK <= 20 || currD <= 20)) {
                markers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#22c55e',
                    shape: 'arrowUp',
                    text: 'STOCH LONG',
                    size: 1
                });
                stochMarkers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#22c55e',
                    shape: 'circle',
                    text: 'L',
                    size: 1
                });
            } else if (prevK > prevD && currK < currD && (currK >= 80 || currD >= 80)) {
                markers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#ef4444',
                    shape: 'arrowDown',
                    text: 'STOCH SHORT',
                    size: 1
                });
                stochMarkers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#ef4444',
                    shape: 'circle',
                    text: 'S',
                    size: 1
                });
            }
        }
        if (stochRsiKSeries) stochRsiKSeries.setMarkers(stochMarkers);
    } else {
        if (stochRsiKSeries) stochRsiKSeries.setMarkers([]);
    }

    markers.sort((a, b) => a.time - b.time);
    candleSeries.setMarkers(markers);
}

function calculateSupertrend(formattedData, period = 10, multiplier = 3.0) {
    const len = formattedData.length;
    if (len < period) return [];

    // Calculate TR
    const tr = new Array(len);
    tr[0] = formattedData[0].high - formattedData[0].low;
    for (let i = 1; i < len; i++) {
        tr[i] = Math.max(
            formattedData[i].high - formattedData[i].low,
            Math.abs(formattedData[i].high - formattedData[i - 1].close),
            Math.abs(formattedData[i].low - formattedData[i - 1].close)
        );
    }

    // Calculate ATR (Wilder's MA / RMA of TR)
    const atr = new Array(len).fill(0);
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += tr[i];
    }
    atr[period - 1] = sum / period;
    for (let i = period; i < len; i++) {
        atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
    }

    // Supertrend Calculation
    const basicUpperBand = new Array(len);
    const basicLowerBand = new Array(len);
    const finalUpperBand = new Array(len).fill(0);
    const finalLowerBand = new Array(len).fill(0);
    const trend = new Array(len).fill(1); // 1 = Long, -1 = Short

    for (let i = 0; i < len; i++) {
        const hl2 = (formattedData[i].high + formattedData[i].low) / 2;
        basicUpperBand[i] = hl2 + multiplier * atr[i];
        basicLowerBand[i] = hl2 - multiplier * atr[i];
    }

    finalUpperBand[0] = basicUpperBand[0];
    finalLowerBand[0] = basicLowerBand[0];

    for (let i = 1; i < len; i++) {
        // final upper band
        if (basicUpperBand[i] < finalUpperBand[i - 1] || formattedData[i - 1].close > finalUpperBand[i - 1]) {
            finalUpperBand[i] = basicUpperBand[i];
        } else {
            finalUpperBand[i] = finalUpperBand[i - 1];
        }

        // final lower band
        if (basicLowerBand[i] > finalLowerBand[i - 1] || formattedData[i - 1].close < finalLowerBand[i - 1]) {
            finalLowerBand[i] = basicLowerBand[i];
        } else {
            finalLowerBand[i] = finalLowerBand[i - 1];
        }

        // Trend
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

function renderSupertrend() {
    // 1. Remove all existing temporary Supertrend series
    supertrendSeriesList.forEach(series => {
        try {
            chart.removeSeries(series);
        } catch (e) { }
    });
    supertrendSeriesList = [];

    const toggleSupertrend = document.getElementById('toggle-supertrend');
    const isVisible = toggleSupertrend ? toggleSupertrend.checked : false;
    if (!isVisible) return;

    const data = window.klineData;
    if (!data || data.length === 0) return;

    const results = calculateSupertrend(data, supertrendPeriod, supertrendMultiplier);
    if (results.length === 0) return;

    // 2. Extract consecutive long/short segments
    const segments = [];
    let currentSegment = null;

    for (let i = 0; i < results.length; i++) {
        const item = results[i];
        if (item.value === null) {
            if (currentSegment) {
                segments.push(currentSegment);
                currentSegment = null;
            }
            continue;
        }

        if (!currentSegment) {
            currentSegment = {
                trend: item.trend,
                data: [{ time: item.time, value: item.value }]
            };
        } else if (currentSegment.trend === item.trend) {
            currentSegment.data.push({ time: item.time, value: item.value });
        } else {
            // Trend flipped -> push segment and start a new one
            segments.push(currentSegment);
            currentSegment = {
                trend: item.trend,
                data: [{ time: item.time, value: item.value }]
            };
        }
    }
    if (currentSegment) {
        segments.push(currentSegment);
    }

    // 3. Render each segment as a separate Line Series
    segments.forEach(seg => {
        const series = chart.addLineSeries({
            color: seg.trend === 1 ? '#2ebd85' : '#f6465d',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false
        });
        series.setData(seg.data);
        supertrendSeriesList.push(series);
    });
}

function updateWTPriceLines() {
    wtPriceLines.forEach(line => {
        try {
            wt1Series.removePriceLine(line);
        } catch (e) { }
    });
    wtPriceLines = [];

    if (!wt1Series) return;

    const obLine = wt1Series.createPriceLine({
        price: WT_OB_LEVEL,
        color: 'rgba(250, 204, 21, 0.8)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Overbought (${WT_OB_LEVEL})`,
    });
    const zeroLine = wt1Series.createPriceLine({
        price: 0,
        color: 'rgba(255, 255, 255, 0.3)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: false,
    });
    const osLine = wt1Series.createPriceLine({
        price: -WT_OB_LEVEL,
        color: 'rgba(250, 204, 21, 0.8)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Oversold (-${WT_OB_LEVEL})`,
    });

    wtPriceLines.push(obLine, zeroLine, osLine);
}

function updateStochPriceLines() {
    stochPriceLines.forEach(line => {
        try {
            stochRsiKSeries.removePriceLine(line);
        } catch (e) { }
    });
    stochPriceLines = [];

    if (!stochRsiKSeries) return;

    const obLine = stochRsiKSeries.createPriceLine({
        price: 80,
        color: 'rgba(239, 68, 68, 0.6)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Overbought (80)',
    });
    const osLine = stochRsiKSeries.createPriceLine({
        price: 20,
        color: 'rgba(34, 197, 94, 0.6)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Oversold (20)',
    });

    stochPriceLines.push(obLine, osLine);
}

// Tracked from Server
let virtualCapital = 0;
let leverage = 1;
let tpslEnabled = false;
let tpRoi = 10;
let slRoi = -5;
let activePosition = null;
let tradeHistory = [];

const BB_PERIOD = 20;
const BB_STD_DEV = 2;

// --- Authentication & API Logic ---

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': authToken ? `Bearer ${authToken}` : ''
    };
}

async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const options = { method, headers: getHeaders() };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(`${API_URL}${endpoint}`, options);
        const data = await res.json();

        if (res.status === 401 || res.status === 403) {
            handleLogout();
            throw new Error("Unauthorized. Please login again.");
        }
        if (!res.ok) throw new Error(data.error || "API Error");
        return data;
    } catch (e) {
        alert(e.message);
        throw e;
    }
}

function handleLogout() {
    authToken = null;
    currentUsername = null;
    localStorage.removeItem('cats_token');
    localStorage.removeItem('cats_username');
    activePosition = null;
    tradeHistory = [];
    ws?.close();

    // Reset auto trade states
    autoTradeEnabled = false;
    signalType = 'none';
    if (signalSelect) {
        signalSelect.value = 'none';
        signalSelect.disabled = true;
    }
    if (toggleAutoTrade) {
        toggleAutoTrade.checked = false;
        toggleAutoTrade.disabled = true;
    }
    updateBotState();

    updateAuthUI();
    connectWebSocket(currentSymbol); // Connect anonymously to view chart
}

function updateAuthUI() {
    if (authToken) {
        btnOpenLogin.style.display = 'none';
        btnLogout.style.display = 'block';
        userDisplay.style.display = 'block';
        userDisplay.textContent = `Hello, ${currentUsername}`;

        btnLong.disabled = false;
        btnShort.disabled = false;
        btnRecharge.disabled = false;
        document.getElementById('leverage-input').disabled = false;
        document.getElementById('capital-input').disabled = false;
        if (signalSelect) signalSelect.disabled = false;
        if (toggleAutoTrade) toggleAutoTrade.disabled = false;
    } else {
        btnOpenLogin.style.display = 'block';
        btnLogout.style.display = 'none';
        userDisplay.style.display = 'none';

        btnLong.disabled = true;
        btnShort.disabled = true;
        btnRecharge.disabled = true;
        document.getElementById('leverage-input').disabled = true;
        document.getElementById('capital-input').disabled = true;
        document.getElementById('capital-input').value = '-';
        if (signalSelect) signalSelect.disabled = true;
        if (toggleAutoTrade) toggleAutoTrade.disabled = true;

        activePosInfo.classList.add('hidden');
    }
}

async function fetchAccountData() {
    if (!authToken) return;
    try {
        const data = await apiCall('/account');
        const acc = data.account;

        virtualCapital = acc.virtual_capital;
        leverage = acc.leverage;
        tpslEnabled = acc.tpsl_enabled === 1;
        tpRoi = acc.tp_roi;
        slRoi = acc.sl_roi;
        autoTradeEnabled = acc.auto_trade_enabled === 1;
        signalType = acc.signal_type || 'none';

        MACD_TF = acc.macd_tf || '5m';
        MACD_FAST = acc.macd_fast || 12;
        MACD_SLOW = acc.macd_slow || 26;
        MACD_SIG = acc.macd_sig || 9;
        MACD_ALLOW_REPAINT = acc.macd_allow_repaint === 1;

        STOCH_TF = acc.stoch_tf || '5m';
        STOCH_RSI_LEN = acc.stoch_rsi_len || 14;
        STOCH_LEN = acc.stoch_len || 14;
        STOCH_K = acc.stoch_k || 3;
        STOCH_D = acc.stoch_d || 3;
        STOCH_ALLOW_REPAINT = acc.stoch_allow_repaint === 1;

        const macdTfInput = document.getElementById('macd-tf');
        if (macdTfInput) macdTfInput.value = MACD_TF;
        const macdFastInput = document.getElementById('macd-fast');
        if (macdFastInput) macdFastInput.value = MACD_FAST;
        const macdSlowInput = document.getElementById('macd-slow');
        if (macdSlowInput) macdSlowInput.value = MACD_SLOW;
        const macdSigInput = document.getElementById('macd-sig');
        if (macdSigInput) macdSigInput.value = MACD_SIG;
        const macdRepaintInput = document.getElementById('macd-allow-repaint');
        if (macdRepaintInput) macdRepaintInput.checked = MACD_ALLOW_REPAINT;

        const stochTfInput = document.getElementById('stoch-tf');
        if (stochTfInput) stochTfInput.value = STOCH_TF;
        const stochRsiLenInput = document.getElementById('stoch-rsi-len');
        if (stochRsiLenInput) stochRsiLenInput.value = STOCH_RSI_LEN;
        const stochLenInput = document.getElementById('stoch-len');
        if (stochLenInput) stochLenInput.value = STOCH_LEN;
        const stochKInput = document.getElementById('stoch-k');
        if (stochKInput) stochKInput.value = STOCH_K;
        const stochDInput = document.getElementById('stoch-d');
        if (stochDInput) stochDInput.value = STOCH_D;
        const stochRepaintInput = document.getElementById('stoch-allow-repaint');
        if (stochRepaintInput) stochRepaintInput.checked = STOCH_ALLOW_REPAINT;

        document.getElementById('capital-input').value = virtualCapital.toFixed(2);
        document.getElementById('leverage-input').value = leverage;
        document.getElementById('toggle-tpsl').checked = tpslEnabled;
        document.getElementById('tp-input').value = tpRoi;
        document.getElementById('sl-input').value = slRoi;

        if (signalSelect) signalSelect.value = signalType;
        if (toggleAutoTrade) toggleAutoTrade.checked = autoTradeEnabled;

        if (data.activePosition) {
            activePosition = data.activePosition;
            renderActivePosition();
        } else {
            activePosition = null;
            activePosInfo.classList.add('hidden');
        }

        if (acc.symbol && acc.symbol !== currentSymbol) {
            currentSymbol = acc.symbol;
            symbolSelect.value = currentSymbol;
            await loadChartData(currentSymbol);
        }
        updateBotState();
    } catch (e) { }
}

function updateBotState() {
    if (!botStateBadge) return;

    if (!autoTradeEnabled || signalType === 'none') {
        botStateBadge.className = 'badge badge-inactive';
        botStateBadge.textContent = 'Off';
        return;
    }

    if (activePosition) {
        if (activePosition.side === 'LONG') {
            botStateBadge.className = 'badge badge-long';
            botStateBadge.textContent = 'LONG Active';
        } else {
            botStateBadge.className = 'badge badge-short';
            botStateBadge.textContent = 'SHORT Active';
        }
    } else {
        botStateBadge.className = 'badge badge-active';
        botStateBadge.textContent = 'Monitoring';
    }
}

async function updateConfig() {
    if (!authToken) return;
    const wtN1 = parseInt(document.getElementById('wt-n1')?.value || WT_CHANNEL_LEN, 10);
    const wtN2 = parseInt(document.getElementById('wt-n2')?.value || WT_AVG_LEN, 10);
    const wtSig = parseInt(document.getElementById('wt-sig')?.value || WT_SIG_LEN, 10);
    const wtOb = parseInt(document.getElementById('wt-ob')?.value || WT_OB_LEVEL, 10);

    const macdTf = document.getElementById('macd-tf')?.value || MACD_TF;
    const macdFast = parseInt(document.getElementById('macd-fast')?.value || MACD_FAST, 10);
    const macdSlow = parseInt(document.getElementById('macd-slow')?.value || MACD_SLOW, 10);
    const macdSig = parseInt(document.getElementById('macd-sig')?.value || MACD_SIG, 10);
    const macdAllowRepaint = document.getElementById('macd-allow-repaint')?.checked || false;

    const stochTf = document.getElementById('stoch-tf')?.value || STOCH_TF;
    const stochRsiLen = parseInt(document.getElementById('stoch-rsi-len')?.value || STOCH_RSI_LEN, 10);
    const stochLen = parseInt(document.getElementById('stoch-len')?.value || STOCH_LEN, 10);
    const stochK = parseInt(document.getElementById('stoch-k')?.value || STOCH_K, 10);
    const stochD = parseInt(document.getElementById('stoch-d')?.value || STOCH_D, 10);
    const stochAllowRepaint = document.getElementById('stoch-allow-repaint')?.checked || false;

    try {
        await apiCall('/account/config', 'POST', {
            leverage: parseInt(document.getElementById('leverage-input').value) || 1,
            tpsl_enabled: document.getElementById('toggle-tpsl').checked,
            tp_roi: parseFloat(document.getElementById('tp-input').value) || 10,
            sl_roi: parseFloat(document.getElementById('sl-input').value) || -5,
            auto_trade_enabled: toggleAutoTrade ? toggleAutoTrade.checked : false,
            signal_type: signalSelect ? signalSelect.value : 'none',
            wt_n1: wtN1,
            wt_n2: wtN2,
            wt_sig: wtSig,
            wt_ob: wtOb,
            macd_tf: macdTf,
            macd_fast: macdFast,
            macd_slow: macdSlow,
            macd_sig: macdSig,
            macd_allow_repaint: macdAllowRepaint,
            stoch_tf: stochTf,
            stoch_rsi_len: stochRsiLen,
            stoch_len: stochLen,
            stoch_k: stochK,
            stoch_d: stochD,
            stoch_allow_repaint: stochAllowRepaint,
            symbol: currentSymbol
        });
        autoTradeEnabled = toggleAutoTrade ? toggleAutoTrade.checked : false;
        signalType = signalSelect ? signalSelect.value : 'none';
        updateBotState();
    } catch (e) { }
}

async function fetchHistory() {
    if (!authToken) return;
    try {
        tradeHistory = await apiCall('/history');
    } catch (e) { }
}

// --- Initialization ---

async function init() {
    loadUIConfig();
    updateAuthUI();
    initChart();
    await loadSymbols();
    await loadChartData(currentSymbol);

    if (authToken) {
        await fetchAccountData();
    }

    // Check backend health periodically
    setInterval(updateBackendStatus, 10000);
    updateBackendStatus();

    // Set up Auth bindings
    btnOpenLogin.addEventListener('click', () => {
        authModal.classList.remove('hidden');
    });
    btnCloseAuth.addEventListener('click', () => {
        authModal.classList.add('hidden');
    });
    btnLogout.addEventListener('click', handleLogout);

    // Mobile specific interactions
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            headerControls.classList.toggle('show');
            authControls.classList.toggle('show');
        });
    }

    if (mobileTradeBtn) {
        mobileTradeBtn.addEventListener('click', () => {
            tradePanel.classList.toggle('show');
            if (tradePanel.classList.contains('show')) {
                mobileTradeBtn.innerHTML = '❌ Close';
                mobileTradeBtn.style.backgroundColor = 'var(--panel-bg)';
            } else {
                mobileTradeBtn.innerHTML = '💬 Trade';
                mobileTradeBtn.style.backgroundColor = 'var(--accent-color)';
            }
        });
    }

    btnRecharge.addEventListener('click', async () => {
        if (!authToken) return;
        const newCap = parseFloat(document.getElementById('capital-input').value);
        if (isNaN(newCap) || newCap < 0) return alert('Invalid capital amount');

        try {
            const res = await apiCall('/account/recharge', 'POST', { virtual_capital: newCap });
            document.getElementById('capital-input').value = res.virtual_capital.toFixed(2);
            virtualCapital = res.virtual_capital;
            alert(`Capital has been set to ${res.virtual_capital} USDT`);
        } catch (e) { }
    });

    authToggleLink.addEventListener('click', (e) => {
        e.preventDefault();
        isLoginMode = !isLoginMode;
        authTitle.textContent = isLoginMode ? "Login to CATS" : "Register for CATS";
        btnAuthSubmit.textContent = isLoginMode ? "Login" : "Register";
        document.getElementById('auth-toggle-text').innerHTML = isLoginMode
            ? `Don't have an account? <a href="#" id="auth-toggle-link" style="color:var(--up-color); text-decoration:none;">Register here</a>`
            : `Already have an account? <a href="#" id="auth-toggle-link" style="color:var(--up-color); text-decoration:none;">Login here</a>`;

        // Re-bind dynamically injected link
        document.getElementById('auth-toggle-link').addEventListener('click', (ev) => {
            ev.preventDefault();
            authToggleLink.click();
        });
    });

    btnAuthSubmit.addEventListener('click', async () => {
        const username = authUsername.value;
        const password = authPassword.value;
        if (!username || !password) return alert('Enter credentials');

        const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
        try {
            const res = await apiCall(endpoint, 'POST', { username, password });
            if (isLoginMode) {
                authToken = res.token;
                currentUsername = res.username;
                localStorage.setItem('cats_token', authToken);
                localStorage.setItem('cats_username', currentUsername);
                authModal.classList.add('hidden');
                updateAuthUI();
                await fetchAccountData();
                ws.close(); // Refresh WS for auth
                connectWebSocket(currentSymbol);
                alert('Successfully logged in!');
            } else {
                alert('Registration successful! You can now login.');
                authToggleLink.click();
            }
        } catch (e) { }
    });

    document.getElementById('leverage-input').addEventListener('change', updateConfig);
    document.getElementById('toggle-tpsl').addEventListener('change', updateConfig);
    document.getElementById('tp-input').addEventListener('change', updateConfig);
    document.getElementById('sl-input').addEventListener('change', updateConfig);
    if (toggleAutoTrade) toggleAutoTrade.addEventListener('change', updateConfig);
    if (signalSelect) signalSelect.addEventListener('change', updateConfig);

    // Indicator toggles (local only)
    document.getElementById('toggle-ma').addEventListener('change', (e) => {
        if (maSeries) maSeries.applyOptions({ visible: e.target.checked });
        saveUIConfig();
    });
    document.getElementById('ma-length').addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        e.target.value = val;
        maPeriod = val;
        if (window.klineData) updateChartSeries();
        saveUIConfig();
    });
    document.getElementById('toggle-bb').addEventListener('change', (e) => {
        const isVisible = e.target.checked;
        if (bbUpperSeries) bbUpperSeries.applyOptions({ visible: isVisible });
        if (bbLowerSeries) bbLowerSeries.applyOptions({ visible: isVisible });
        if (bbMiddleSeries) bbMiddleSeries.applyOptions({ visible: isVisible });
        saveUIConfig();
    });

    const toggleWT = document.getElementById('toggle-wt');
    const wtContainer = document.getElementById('wt-chart-container');
    const resizer = document.getElementById('chart-resizer');
    const wtParamsContainer = document.getElementById('wt-params-container');

    const updateWTVisibility = () => {
        const isVisible = toggleWT.checked;
        if (isVisible) {
            wtContainer.classList.remove('hidden');
            resizer.classList.remove('hidden');
            wtParamsContainer?.classList.remove('hidden');
        } else {
            wtContainer.classList.add('hidden');
            resizer.classList.add('hidden');
            wtParamsContainer?.classList.add('hidden');
        }
        saveUIConfig();
        applyIndicatorMarkers();
    };
    toggleWT.addEventListener('change', updateWTVisibility);

    const toggleMACD = document.getElementById('toggle-macd');
    const macdContainer = document.getElementById('macd-chart-container');
    const resizerMacd = document.getElementById('chart-resizer-macd');
    const macdParamsContainer = document.getElementById('macd-params-container');

    const updateMACDVisibility = () => {
        const isVisible = toggleMACD.checked;
        if (isVisible) {
            macdContainer.classList.remove('hidden');
            resizerMacd.classList.remove('hidden');
            macdParamsContainer?.classList.remove('hidden');
        } else {
            macdContainer.classList.add('hidden');
            resizerMacd.classList.add('hidden');
            macdParamsContainer?.classList.add('hidden');
        }
        saveUIConfig();
        applyIndicatorMarkers();
    };
    toggleMACD.addEventListener('change', updateMACDVisibility);

    // WaveTrend Parameter Inputs Event Listeners
    const bindWTParamInput = (id, minVal) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < minVal) val = minVal;
            e.target.value = val;

            if (id === 'wt-n1') WT_CHANNEL_LEN = val;
            else if (id === 'wt-n2') WT_AVG_LEN = val;
            else if (id === 'wt-sig') WT_SIG_LEN = val;
            else if (id === 'wt-ob') WT_OB_LEVEL = val;

            updateWTPriceLines();
            if (window.klineData) updateChartSeries();
            saveUIConfig();

            if (authToken) {
                await updateConfig();
            }
        });
    };

    bindWTParamInput('wt-n1', 1);
    bindWTParamInput('wt-n2', 1);
    bindWTParamInput('wt-sig', 1);
    bindWTParamInput('wt-ob', 1);

    // MACD Parameter Inputs Event Listeners
    const bindMACDParamInput = (id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < 1) val = 1;
            e.target.value = val;

            if (id === 'macd-fast') MACD_FAST = val;
            else if (id === 'macd-slow') MACD_SLOW = val;
            else if (id === 'macd-sig') MACD_SIG = val;

            if (window.klineData) updateChartSeries();
            saveUIConfig();

            if (authToken) {
                await updateConfig();
            }
        });
    };

    bindMACDParamInput('macd-fast');
    bindMACDParamInput('macd-slow');
    bindMACDParamInput('macd-sig');

    const macdRepaintInput = document.getElementById('macd-allow-repaint');
    if (macdRepaintInput) {
        macdRepaintInput.addEventListener('change', async (e) => {
            MACD_ALLOW_REPAINT = e.target.checked;
            if (authToken) {
                await updateConfig();
            }
        });
    }

    const macdTfInput = document.getElementById('macd-tf');
    if (macdTfInput) {
        macdTfInput.addEventListener('change', async (e) => {
            MACD_TF = e.target.value;
            if (window.klineData) updateChartSeries();
            saveUIConfig();
            if (authToken) {
                await updateConfig();
            }
        });
    }

    // Supertrend Binding Logic
    const toggleSupertrend = document.getElementById('toggle-supertrend');
    const supertrendParamsContainer = document.getElementById('supertrend-params-container');

    const updateSupertrendVisibility = () => {
        if (!toggleSupertrend) return;
        const isVisible = toggleSupertrend.checked;
        if (isVisible) {
            supertrendParamsContainer?.classList.remove('hidden');
        } else {
            supertrendParamsContainer?.classList.add('hidden');
        }
        if (window.klineData) {
            renderSupertrend();
        }
        saveUIConfig();
    };

    if (toggleSupertrend) {
        toggleSupertrend.addEventListener('change', updateSupertrendVisibility);
    }

    const stPeriodEl = document.getElementById('supertrend-period');
    const stMultEl = document.getElementById('supertrend-multiplier');

    const onSupertrendParamChange = () => {
        if (!stPeriodEl || !stMultEl) return;
        let pVal = parseInt(stPeriodEl.value, 10);
        let mVal = parseFloat(stMultEl.value);
        if (isNaN(pVal) || pVal < 1) pVal = 10;
        if (isNaN(mVal) || mVal <= 0) mVal = 3.0;

        stPeriodEl.value = pVal;
        stMultEl.value = mVal;

        supertrendPeriod = pVal;
        supertrendMultiplier = mVal;

        if (window.klineData) updateChartSeries();
        saveUIConfig();
    };

    if (stPeriodEl) stPeriodEl.addEventListener('change', onSupertrendParamChange);
    if (stMultEl) stMultEl.addEventListener('change', onSupertrendParamChange);

    // Stochastic RSI Binding Logic
    const toggleStoch = document.getElementById('toggle-stoch-rsi');
    const stochContainer = document.getElementById('stoch-chart-container');
    const resizerStoch = document.getElementById('chart-resizer-stoch');
    const stochParamsContainer = document.getElementById('stoch-params-container');

    const updateStochVisibility = () => {
        if (!toggleStoch) return;
        const isVisible = toggleStoch.checked;
        if (isVisible) {
            stochContainer?.classList.remove('hidden');
            resizerStoch?.classList.remove('hidden');
            stochParamsContainer?.classList.remove('hidden');
        } else {
            stochContainer?.classList.add('hidden');
            resizerStoch?.classList.add('hidden');
            stochParamsContainer?.classList.add('hidden');
        }
        saveUIConfig();
        applyIndicatorMarkers();
    };

    if (toggleStoch) {
        toggleStoch.addEventListener('change', updateStochVisibility);
    }

    const bindStochParamInput = (id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < 1) val = 1;
            e.target.value = val;

            if (id === 'stoch-rsi-len') STOCH_RSI_LEN = val;
            else if (id === 'stoch-len') STOCH_LEN = val;
            else if (id === 'stoch-k') STOCH_K = val;
            else if (id === 'stoch-d') STOCH_D = val;

            updateStochPriceLines();
            if (window.klineData) updateChartSeries();
            saveUIConfig();

            if (authToken) {
                await updateConfig();
            }
        });
    };

    bindStochParamInput('stoch-rsi-len');
    bindStochParamInput('stoch-len');
    bindStochParamInput('stoch-k');
    bindStochParamInput('stoch-d');

    const stochRepaintInput = document.getElementById('stoch-allow-repaint');
    if (stochRepaintInput) {
        stochRepaintInput.addEventListener('change', async (e) => {
            STOCH_ALLOW_REPAINT = e.target.checked;
            if (window.klineData) updateChartSeries();
            saveUIConfig();
            if (authToken) {
                await updateConfig();
            }
        });
    }

    const stochTfInput = document.getElementById('stoch-tf');
    if (stochTfInput) {
        stochTfInput.addEventListener('change', async (e) => {
            STOCH_TF = e.target.value;
            if (window.klineData) updateChartSeries();
            saveUIConfig();
            if (authToken) {
                await updateConfig();
            }
        });
    }

    // Resizer Dragging Logic
    let activeResizer = null;
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const startResize = (clientY, resizerEl, containerEl) => {
        isResizing = true;
        activeResizer = { element: resizerEl, container: containerEl };
        startY = clientY;
        startHeight = containerEl.clientHeight;
        document.body.style.cursor = 'row-resize';
        resizerEl.classList.add('resizing');
    };

    const doResize = (clientY) => {
        if (!isResizing || !activeResizer) return;
        const dy = clientY - startY;
        let newHeight = startHeight - dy;
        if (newHeight < 60) newHeight = 60;
        if (newHeight > 500) newHeight = 500;
        activeResizer.container.style.height = `${newHeight}px`;
    };

    const stopResize = () => {
        if (isResizing) {
            isResizing = false;
            if (activeResizer) {
                activeResizer.element.classList.remove('resizing');
            }
            activeResizer = null;
            document.body.style.cursor = '';
            saveUIConfig();
        }
    };

    resizer.addEventListener('mousedown', (e) => {
        startResize(e.clientY, resizer, wtContainer);
        e.preventDefault();
    });

    resizer.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            startResize(e.touches[0].clientY, resizer, wtContainer);
            e.preventDefault();
        }
    }, { passive: false });

    if (resizerMacd) {
        resizerMacd.addEventListener('mousedown', (e) => {
            startResize(e.clientY, resizerMacd, macdContainer);
            e.preventDefault();
        });

        resizerMacd.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                startResize(e.touches[0].clientY, resizerMacd, macdContainer);
                e.preventDefault();
            }
        }, { passive: false });
    }

    if (resizerStoch) {
        resizerStoch.addEventListener('mousedown', (e) => {
            startResize(e.clientY, resizerStoch, stochContainer);
            e.preventDefault();
        });

        resizerStoch.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                startResize(e.touches[0].clientY, resizerStoch, stochContainer);
                e.preventDefault();
            }
        }, { passive: false });
    }

    document.addEventListener('mousemove', (e) => {
        doResize(e.clientY);
    });

    document.addEventListener('touchmove', (e) => {
        if (isResizing && e.touches.length > 0) {
            doResize(e.touches[0].clientY);
            e.preventDefault();
        }
    }, { passive: false });

    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchend', stopResize);

    // Trading Execution
    btnLong.addEventListener('click', () => executeTrade('LONG'));
    btnShort.addEventListener('click', () => executeTrade('SHORT'));
    btnClose.addEventListener('click', closeActiveTrade);

    // History Modal Controls
    btnHistory.addEventListener('click', async () => {
        await fetchHistory();
        renderHistoryTable();
        historyModal.classList.remove('hidden');
    });

    btnCloseHistory.addEventListener('click', () => historyModal.classList.add('hidden'));

    if (btnExportCsv) {
        btnExportCsv.addEventListener('click', () => {
            if (!tradeHistory || tradeHistory.length === 0) {
                alert("내보낼 거래 기록이 없습니다.");
                return;
            }

            const headers = ["Side", "Leverage", "Entry Time", "Exit Time", "Entry Price", "Exit Price", "PnL", "ROE(%)", "Fee", "Capital Before", "Capital After"];
            const rows = tradeHistory.map(row => [
                row.side,
                row.leverage || 1,
                `"${new Date(row.entry_time).toLocaleString()}"`,
                `"${new Date(row.exit_time).toLocaleString()}"`,
                row.entry_price.toFixed(2),
                row.exit_price.toFixed(2),
                row.pnl.toFixed(2),
                row.roe.toFixed(2),
                row.fee.toFixed(2),
                row.capital_before.toFixed(2),
                row.capital_after.toFixed(2)
            ]);

            const csvContent = [headers.join(",")].concat(rows.map(e => e.join(","))).join("\n");

            const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `CATS_Trade_History_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    btnClearHistory.addEventListener('click', () => {
        if (tradeHistory.length === 0) return alert("기록된 거래 내역이 없습니다.");
        confirmModal.classList.remove('hidden');
    });

    btnConfirmCancel.addEventListener('click', () => confirmModal.classList.add('hidden'));

    btnConfirmOk.addEventListener('click', async () => {
        confirmModal.classList.add('hidden');
        if (authToken) {
            await apiCall('/history', 'DELETE');
        }
        tradeHistory = [];
        renderHistoryTable();
    });

    symbolSelect.addEventListener('change', async (e) => {
        currentSymbol = e.target.value;
        await loadChartData(currentSymbol);
        if (authToken) {
            await updateConfig();
        }
    });

    const resizeObserver = new ResizeObserver(entries => {
        if (!chart) return;
        const { width, height } = entries[0].contentRect;
        chart.applyOptions({ width, height });
    });
    resizeObserver.observe(chartContainer);

    const wtResizeObserver = new ResizeObserver(entries => {
        if (!wtChart) return;
        const { width, height } = entries[0].contentRect;
        wtChart.applyOptions({ width, height });
    });
    wtResizeObserver.observe(wtContainer);

    const macdResizeObserver = new ResizeObserver(entries => {
        if (!macdChart) return;
        const { width, height } = entries[0].contentRect;
        macdChart.applyOptions({ width, height });
    });
    macdResizeObserver.observe(document.getElementById('macd-chart-container'));

    const stochResizeObserver = new ResizeObserver(entries => {
        if (!stochRsiChart) return;
        const { width, height } = entries[0].contentRect;
        stochRsiChart.applyOptions({ width, height });
    });
    const stochContainerEl = document.getElementById('stoch-chart-container');
    if (stochContainerEl) {
        stochResizeObserver.observe(stochContainerEl);
    }

    updateWTVisibility();
    updateMACDVisibility();
    updateStochVisibility();
    if (typeof updateSupertrendVisibility === 'function') {
        updateSupertrendVisibility();
    }
}

async function updateBackendStatus() {
    try {
        const res = await fetch(API_URL + '/status');
        const data = await res.json();
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        if (data.binance.status === 'connected') {
            statusDot.className = 'status-dot online';
            statusText.textContent = 'Backend: Online';
        } else {
            statusDot.className = 'status-dot error';
            statusText.textContent = `Backend Error: ${data.binance.status}`;
        }
    } catch (e) {
        document.getElementById('status-dot').className = 'status-dot offline';
        document.getElementById('status-text').textContent = 'Backend: Offline';
    }
}


// --- Chart & Binance Data Proxy ---

function initChart() {
    chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth || 600,
        height: chartContainer.clientHeight || 400,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            minimumWidth: 80
        },
        localization: {
            timeFormatter: (time) => {
                const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
                const d = new Date(time * 1000 + KST_OFFSET_MS);
                const year = d.getUTCFullYear();
                const month = String(d.getUTCMonth() + 1).padStart(2, '0');
                const day = String(d.getUTCDate()).padStart(2, '0');
                const h = String(d.getUTCHours()).padStart(2, '0');
                const m = String(d.getUTCMinutes()).padStart(2, '0');
                return `${year}-${month}-${day} ${h}:${m}`;
            }
        },
        timeScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            timeVisible: true,
            secondsVisible: false,
            tickMarkFormatter: (time, tickMarkType, locale) => {
                const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
                const d = new Date(time * 1000 + KST_OFFSET_MS);

                if (tickMarkType === 0) return d.getUTCFullYear().toString();
                if (tickMarkType === 1) return (d.getUTCMonth() + 1) + '월';
                if (tickMarkType === 2) return d.getUTCDate() + '일';
                if (tickMarkType === 3) {
                    const h = String(d.getUTCHours()).padStart(2, '0');
                    const m = String(d.getUTCMinutes()).padStart(2, '0');
                    return `${h}:${m}`;
                }
                const h = String(d.getUTCHours()).padStart(2, '0');
                const m = String(d.getUTCMinutes()).padStart(2, '0');
                const s = String(d.getUTCSeconds()).padStart(2, '0');
                return `${h}:${m}:${s}`;
            }
        },
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#2ebd85', downColor: '#f6465d',
        borderDownColor: '#f6465d', borderUpColor: '#2ebd85',
        wickDownColor: '#f6465d', wickUpColor: '#2ebd85',
    });

    maSeries = chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-ma').checked });
    bbUpperSeries = chart.addLineSeries({ color: 'rgba(56, 189, 248, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-bb').checked });
    bbMiddleSeries = chart.addLineSeries({ color: 'rgba(56, 189, 248, 0.5)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-bb').checked });
    bbLowerSeries = chart.addLineSeries({ color: 'rgba(56, 189, 248, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-bb').checked });



    // Initialize WaveTrend Chart
    const wtChartContainer = document.getElementById('wt-chart-container');
    wtChart = LightweightCharts.createChart(wtChartContainer, {
        width: wtChartContainer.clientWidth || 600,
        height: wtChartContainer.clientHeight || 150,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            minimumWidth: 80,
        },
        timeScale: {
            visible: false,
        },
    });

    wtChart.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: {
            top: 0.1,
            bottom: 0.1,
        },
    });

    wt1Series = wtChart.addLineSeries({ color: '#2ebd85', lineWidth: 1.5, title: 'WT1', crosshairMarkerVisible: true });
    wt2Series = wtChart.addLineSeries({ color: '#f6465d', lineWidth: 1.5, title: 'WT2', lineStyle: LightweightCharts.LineStyle.Dashed, crosshairMarkerVisible: true });

    // Set horizontal levels for WaveTrend
    updateWTPriceLines();

    // Initialize MACD Chart
    const macdChartContainer = document.getElementById('macd-chart-container');
    macdChart = LightweightCharts.createChart(macdChartContainer, {
        width: macdChartContainer.clientWidth || 600,
        height: macdChartContainer.clientHeight || 150,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            minimumWidth: 80,
        },
        timeScale: {
            visible: false,
        },
    });

    macdChart.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: {
            top: 0.1,
            bottom: 0.1,
        },
    });

    macdLineSeries = macdChart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5, title: 'MACD', crosshairMarkerVisible: true });
    macdSigSeries = macdChart.addLineSeries({ color: '#fb923c', lineWidth: 1.5, title: 'Signal', crosshairMarkerVisible: true });
    macdHistSeries = macdChart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: 'right'
    });

    // Initialize Stochastic RSI Chart
    const stochChartContainer = document.getElementById('stoch-chart-container');
    stochRsiChart = LightweightCharts.createChart(stochChartContainer, {
        width: stochChartContainer.clientWidth || 600,
        height: stochChartContainer.clientHeight || 150,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            minimumWidth: 80,
        },
        timeScale: {
            visible: false,
        },
    });

    stochRsiChart.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: {
            top: 0.1,
            bottom: 0.1,
        },
    });

    stochRsiKSeries = stochRsiChart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5, title: '%K', crosshairMarkerVisible: true });
    stochRsiDSeries = stochRsiChart.addLineSeries({ color: '#fb923c', lineWidth: 1.5, title: '%D', lineStyle: LightweightCharts.LineStyle.Dashed, crosshairMarkerVisible: true });

    updateStochPriceLines();

    // Sync time scales
    chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRange => {
        wtChart.timeScale().setVisibleLogicalRange(logicalRange);
        macdChart.timeScale().setVisibleLogicalRange(logicalRange);
        stochRsiChart.timeScale().setVisibleLogicalRange(logicalRange);
    });
    wtChart.timeScale().subscribeVisibleLogicalRangeChange(logicalRange => {
        chart.timeScale().setVisibleLogicalRange(logicalRange);
        macdChart.timeScale().setVisibleLogicalRange(logicalRange);
        stochRsiChart.timeScale().setVisibleLogicalRange(logicalRange);
    });
    macdChart.timeScale().subscribeVisibleLogicalRangeChange(logicalRange => {
        chart.timeScale().setVisibleLogicalRange(logicalRange);
        wtChart.timeScale().setVisibleLogicalRange(logicalRange);
        stochRsiChart.timeScale().setVisibleLogicalRange(logicalRange);
    });
    stochRsiChart.timeScale().subscribeVisibleLogicalRangeChange(logicalRange => {
        chart.timeScale().setVisibleLogicalRange(logicalRange);
        wtChart.timeScale().setVisibleLogicalRange(logicalRange);
        macdChart.timeScale().setVisibleLogicalRange(logicalRange);
    });

    // Sync crosshairs quad-directionally
    let isSyncingCrosshair = false;
    function syncCrosshair(sourceChart, param) {
        if (isSyncingCrosshair) return;
        isSyncingCrosshair = true;
        try {
            const time = param && param.time;
            if (!time) {
                if (sourceChart !== chart) chart.clearCrosshairPosition();
                if (sourceChart !== wtChart) wtChart.clearCrosshairPosition();
                if (sourceChart !== macdChart) macdChart.clearCrosshairPosition();
                if (sourceChart !== stochRsiChart) stochRsiChart.clearCrosshairPosition();
            } else {
                // Sync main chart
                if (sourceChart !== chart) {
                    let price = 0;
                    if (window.klineData) {
                        const match = window.klineData.find(d => d.time === time);
                        if (match) price = match.close;
                    }
                    chart.setCrosshairPosition(price, time, candleSeries);
                }
                // Sync WaveTrend
                if (sourceChart !== wtChart) {
                    let price = 0;
                    if (window.lastWtData && window.lastWtData.wt1Data) {
                        const match = window.lastWtData.wt1Data.find(d => d.time === time);
                        if (match && match.value !== undefined) price = match.value;
                    }
                    wtChart.setCrosshairPosition(price, time, wt1Series);
                }
                // Sync MACD
                if (sourceChart !== macdChart) {
                    let price = 0;
                    if (window.lastMacdData && window.lastMacdData.macdData) {
                        const match = window.lastMacdData.macdData.find(d => d.time === time);
                        if (match && match.value !== undefined) price = match.value;
                    }
                    macdChart.setCrosshairPosition(price, time, macdLineSeries);
                }
                // Sync StochRSI
                if (sourceChart !== stochRsiChart) {
                    let price = 0;
                    if (window.lastStochData && window.lastStochData.kData) {
                        const match = window.lastStochData.kData.find(d => d.time === time);
                        if (match && match.value !== undefined) price = match.value;
                    }
                    stochRsiChart.setCrosshairPosition(price, time, stochRsiKSeries);
                }
            }
        } catch (e) {
            console.error(e);
        } finally {
            isSyncingCrosshair = false;
        }
    }

    chart.subscribeCrosshairMove(param => syncCrosshair(chart, param));
    wtChart.subscribeCrosshairMove(param => syncCrosshair(wtChart, param));
    macdChart.subscribeCrosshairMove(param => syncCrosshair(macdChart, param));
    stochRsiChart.subscribeCrosshairMove(param => syncCrosshair(stochRsiChart, param));
}

async function loadSymbols() {
    try {
        const response = await fetch(`${BINANCE_REST_URL}/exchangeInfo`);
        const data = await response.json();
        const symbols = data.symbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING').map(s => s.symbol).sort();
        symbolSelect.innerHTML = '';
        symbols.forEach(sym => {
            const option = document.createElement('option');
            option.value = sym;
            option.textContent = sym;
            if (sym === currentSymbol) option.selected = true;
            symbolSelect.appendChild(option);
        });
    } catch (e) {
        currentPriceEl.textContent = 'Network Error';
    }
}

async function loadChartData(symbol) {
    if (ws) { ws.close(); ws = null; }
    try {
        const res1 = await fetch(`${BINANCE_REST_URL}/klines?symbol=${symbol}&interval=1m&limit=1500`);
        const data1 = await res1.json();
        
        let data = data1;
        if (data1.length > 0) {
            const endTime = data1[0][0] - 1;
            const res2 = await fetch(`${BINANCE_REST_URL}/klines?symbol=${symbol}&interval=1m&limit=1500&endTime=${endTime}`);
            const data2 = await res2.json();
            data = data2.concat(data1);
        }

        window.klineData = data.map(d => ({
            time: Math.floor(d[0] / 1000), open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4])
        }));
        updateChartSeries();
        lastClose = window.klineData[window.klineData.length - 1].close;
        updatePriceDisplay(lastClose, window.klineData[window.klineData.length - 2]?.close || lastClose);
        connectWebSocket(symbol);
    } catch (e) {
        currentPriceEl.textContent = 'Error loading data';
    }
}

function updateChartSeries() {
    const formattedData = window.klineData;
    candleSeries.setData(formattedData);

    const maData = [];
    for (let i = maPeriod - 1; i < formattedData.length; i++) {
        let sum = 0;
        for (let j = 0; j < maPeriod; j++) sum += formattedData[i - j].close;
        maData.push({ time: formattedData[i].time, value: sum / maPeriod });
    }
    maSeries.setData(maData);

    const bbUpperData = [], bbLowerData = [], bbMiddleData = [];
    for (let i = BB_PERIOD - 1; i < formattedData.length; i++) {
        let sum = 0;
        for (let j = 0; j < BB_PERIOD; j++) sum += formattedData[i - j].close;
        const sma = sum / BB_PERIOD;
        let varSum = 0;
        for (let j = 0; j < BB_PERIOD; j++) varSum += Math.pow(formattedData[i - j].close - sma, 2);
        const stdDev = Math.sqrt(varSum / BB_PERIOD);

        bbMiddleData.push({ time: formattedData[i].time, value: sma });
        bbUpperData.push({ time: formattedData[i].time, value: sma + (BB_STD_DEV * stdDev) });
        bbLowerData.push({ time: formattedData[i].time, value: sma - (BB_STD_DEV * stdDev) });
    }
    bbMiddleSeries.setData(bbMiddleData);
    bbUpperSeries.setData(bbUpperData);
    bbLowerSeries.setData(bbLowerData);

    const wtData = calculateWaveTrend(formattedData);
    window.lastWtData = wtData;
    wt1Series.setData(wtData.wt1Data);
    wt2Series.setData(wtData.wt2Data);

    // Calculate and Set MACD Data
    const macdData = calculateMTFMacd(formattedData, MACD_TF, MACD_FAST, MACD_SLOW, MACD_SIG, MACD_ALLOW_REPAINT);
    window.lastMacdData = macdData;
    macdLineSeries.setData(macdData.macdData);
    macdSigSeries.setData(macdData.sigData);
    macdHistSeries.setData(macdData.histData);

    // Calculate and Set StochRSI Data
    const stochData = calculateMTFStochRSI(formattedData, STOCH_TF, STOCH_RSI_LEN, STOCH_LEN, STOCH_K, STOCH_D, STOCH_ALLOW_REPAINT);
    window.lastStochData = stochData;
    stochRsiKSeries.setData(stochData.kData);
    stochRsiDSeries.setData(stochData.dData);

    applyIndicatorMarkers();

    // Set Supertrend Data
    renderSupertrend();
}

function updateIndicators() {
    const data = window.klineData;
    if (!data || data.length === 0) return;

    // Update MA: recalculate last point
    if (data.length >= maPeriod) {
        let sum = 0;
        for (let j = 0; j < maPeriod; j++) sum += data[data.length - 1 - j].close;
        maSeries.update({ time: data[data.length - 1].time, value: sum / maPeriod });
    }

    // Update Bollinger Bands: recalculate last point
    if (data.length >= BB_PERIOD) {
        let sum = 0;
        for (let j = 0; j < BB_PERIOD; j++) sum += data[data.length - 1 - j].close;
        const sma = sum / BB_PERIOD;
        let varSum = 0;
        for (let j = 0; j < BB_PERIOD; j++) varSum += Math.pow(data[data.length - 1 - j].close - sma, 2);
        const stdDev = Math.sqrt(varSum / BB_PERIOD);
        const t = data[data.length - 1].time;
        bbMiddleSeries.update({ time: t, value: sma });
        bbUpperSeries.update({ time: t, value: sma + BB_STD_DEV * stdDev });
        bbLowerSeries.update({ time: t, value: sma - BB_STD_DEV * stdDev });
    }

    // Update WaveTrend: recalculate last point
    const wtData = calculateWaveTrend(data);
    window.lastWtData = wtData;
    if (wtData.wt1Data.length > 0) {
        wt1Series.update(wtData.wt1Data[wtData.wt1Data.length - 1]);
        wt2Series.update(wtData.wt2Data[wtData.wt2Data.length - 1]);
    }

    // Update MACD: recalculate last point
    const macdData = calculateMTFMacd(data, MACD_TF, MACD_FAST, MACD_SLOW, MACD_SIG, MACD_ALLOW_REPAINT);
    window.lastMacdData = macdData;
    if (macdData.macdData.length > 0) {
        macdLineSeries.update(macdData.macdData[macdData.macdData.length - 1]);
        macdSigSeries.update(macdData.sigData[macdData.sigData.length - 1]);
        macdHistSeries.update(macdData.histData[macdData.histData.length - 1]);
    }

    // Update StochRSI: recalculate last point
    const stochData = calculateMTFStochRSI(data, STOCH_TF, STOCH_RSI_LEN, STOCH_LEN, STOCH_K, STOCH_D, STOCH_ALLOW_REPAINT);
    window.lastStochData = stochData;
    if (stochData.kData.length > 0) {
        stochRsiKSeries.update(stochData.kData[stochData.kData.length - 1]);
        stochRsiDSeries.update(stochData.dData[stochData.dData.length - 1]);
    }

    applyIndicatorMarkers();

    // Update Supertrend
    renderSupertrend();
}

function connectWebSocket(symbol) {
    const qs = authToken ? `?token=${authToken}` : '';
    ws = new WebSocket(`${WS_URL}${qs}`);

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        // Binance Stream Forwarded
        if (message.e === 'kline' && message.s === symbol) {
            const kline = message.k;
            const tick = {
                time: Math.floor(kline.t / 1000), open: parseFloat(kline.o), high: parseFloat(kline.h), low: parseFloat(kline.l), close: parseFloat(kline.c)
            };
            candleSeries.update(tick);

            const lastExistingTick = window.klineData[window.klineData.length - 1];
            if (lastExistingTick && lastExistingTick.time === tick.time) {
                window.klineData[window.klineData.length - 1] = tick;
            } else {
                window.klineData.push(tick);
            }

            // 지표 실시간 업데이트
            updateIndicators();

            updatePriceDisplay(tick.close, lastClose);

            if (activePosition && authToken) {
                updateVisualPnL(tick.close);
            }

            lastClose = tick.close;
        }

        // Heartbeat handling
        if (message.type === 'hb') {
            lastHB = Date.now();
            console.log('Heartbeat received');
            return;
        }

        // Backend Event: Auto Trade Position Opened
        if (message.type === 'position_opened') {
            activePosition = message.data;
            renderActivePosition();
            fetchAccountData();
        }

        // Backend Event: Position Closed (TPSL, Liquidation, or Auto Trade reversal)
        if (message.type === 'position_closed') {
            console.log(`[Position Closed] PnL: ${message.data.pnl.toFixed(2)} USDT (${message.data.roe.toFixed(2)}%)`);
            activePosition = null;
            activePosInfo.classList.add('hidden');
            fetchAccountData();
        }
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting in 3 seconds...');
        setTimeout(() => connectWebSocket(symbol), 3000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        ws.close();
    };
}

function updatePriceDisplay(current, previous) {
    let formatStr = current.toFixed(current < 1 ? 5 : 2);
    if (current > previous) currentPriceEl.className = 'price up';
    else if (current < previous) currentPriceEl.className = 'price down';
    currentPriceEl.textContent = formatStr;
}

// --- Trade Execution Flow to Backend ---

async function executeTrade(side) {
    if (activePosition) return alert("A position is already open.");
    try {
        const res = await apiCall('/trade/open', 'POST', { side, symbol: currentSymbol, currentPrice: lastClose });
        await fetchAccountData();
    } catch (e) { }
}

async function closeActiveTrade() {
    if (!activePosition) return;
    try {
        const res = await apiCall('/trade/close', 'POST', { currentPrice: lastClose });
        activePosition = null;
        document.getElementById('capital-input').value = res.newCapital.toFixed(2);
        activePosInfo.classList.add('hidden');
        btnLong.disabled = false;
        btnShort.disabled = false;
    } catch (e) { }
}

function formatEntryTime(timeStr) {
    if (!timeStr) return '-';
    try {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) {
            const cleanStr = timeStr.replace(' ', 'T');
            const fallbackDate = new Date(cleanStr);
            if (!isNaN(fallbackDate.getTime())) {
                return fallbackDate.toLocaleString();
            }
            return timeStr;
        }
        return date.toLocaleString();
    } catch (e) {
        return timeStr;
    }
}

function renderActivePosition() {
    btnLong.disabled = true;
    btnShort.disabled = true;
    activePosInfo.classList.remove('hidden');
    if (posSymbolEl) {
        posSymbolEl.textContent = activePosition.symbol || '';
    }
    if (posEntryTimeEl) {
        posEntryTimeEl.textContent = formatEntryTime(activePosition.entry_time || activePosition.entryTime);
    }
    posSideEl.textContent = activePosition.side;
    posSideEl.style.color = activePosition.side === 'LONG' ? 'var(--up-color)' : 'var(--down-color)';
    if (posEntryTypeEl) {
        const type = activePosition.entry_type || activePosition.entryType || 'MANUAL';
        posEntryTypeEl.textContent = type === 'AUTO' ? 'Auto (🤖)' : 'Manual (👤)';
        posEntryTypeEl.style.color = type === 'AUTO' ? 'var(--accent-color)' : 'var(--text-secondary)';
    }

    // Support both entry_price and entryPrice properties for consistency between DB and WebSocket events
    const entryPrice = activePosition.entry_price !== undefined ? activePosition.entry_price : activePosition.entryPrice;
    posEntryEl.textContent = entryPrice ? entryPrice.toFixed(2) : '-';

    posMarginEl.textContent = activePosition.margin ? activePosition.margin.toFixed(2) + " USDT" : '-';
    posSizeEl.textContent = activePosition.size ? activePosition.size.toFixed(4) : '-';
    updateVisualPnL(lastClose);
}

function updateVisualPnL(currentPrice) {
    if (!activePosition || !currentPrice) return;
    let pnl = 0, priceMovePct = 0;
    if (activePosition.side === 'LONG') {
        pnl = (currentPrice - activePosition.entry_price) * activePosition.size;
        priceMovePct = ((currentPrice - activePosition.entry_price) / activePosition.entry_price) * 100;
    } else {
        pnl = (activePosition.entry_price - currentPrice) * activePosition.size;
        priceMovePct = ((activePosition.entry_price - currentPrice) / activePosition.entry_price) * 100;
    }
    const roe = priceMovePct * activePosition.leverage;

    posPnlEl.textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`;
    posPnlEl.className = `pnl-val ${pnl >= 0 ? 'up' : 'down'}`;
    posRoeEl.textContent = `${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%`;
    posRoeEl.className = `pnl-val ${roe >= 0 ? 'up' : 'down'}`;
}

function renderHistoryTable() {
    historyTbody.innerHTML = '';
    if (tradeHistory.length === 0) {
        historyTbody.innerHTML = '<tr><td colspan="11" style="text-align: center;">No completed trades yet.</td></tr>';
        return;
    }

    tradeHistory.forEach(row => {
        const tr = document.createElement('tr');
        const pnlClass = row.pnl >= 0 ? 'up' : 'down';
        tr.innerHTML = `
            <td class="${row.side}">${row.side}</td>
            <td>${row.leverage || 1}x</td>
            <td>${new Date(row.entry_time).toLocaleString()}</td>
            <td>${new Date(row.exit_time).toLocaleString()}</td>
            <td>${row.entry_price.toFixed(2)}</td>
            <td>${row.exit_price.toFixed(2)}</td>
            <td class="${pnlClass}">${row.pnl > 0 ? '+' : ''}${row.pnl.toFixed(2)}</td>
            <td class="${pnlClass}">${row.roe > 0 ? '+' : ''}${row.roe.toFixed(2)}%</td>
            <td>${row.fee.toFixed(2)}</td>
            <td>${row.capital_before.toFixed(2)}</td>
            <td>${row.capital_after.toFixed(2)}</td>
        `;
        historyTbody.appendChild(tr);
    });
}

function saveUIConfig() {
    const uiConfig = {
        showMA: document.getElementById('toggle-ma').checked,
        maPeriod: parseInt(document.getElementById('ma-length').value, 10),
        showBB: document.getElementById('toggle-bb').checked,
        showWT: document.getElementById('toggle-wt').checked,
        wtHeight: parseInt(document.getElementById('wt-chart-container').style.height || '150', 10),
        wtN1: parseInt(document.getElementById('wt-n1')?.value || '10', 10),
        wtN2: parseInt(document.getElementById('wt-n2')?.value || '21', 10),
        wtSig: parseInt(document.getElementById('wt-sig')?.value || '4', 10),
        wtOb: parseInt(document.getElementById('wt-ob')?.value || '53', 10),
        showSupertrend: document.getElementById('toggle-supertrend')?.checked || false,
        supertrendPeriod: parseInt(document.getElementById('supertrend-period')?.value || '10', 10),
        supertrendMultiplier: parseFloat(document.getElementById('supertrend-multiplier')?.value || '3.0'),
        showMACD: document.getElementById('toggle-macd')?.checked || false,
        macdHeight: parseInt(document.getElementById('macd-chart-container')?.style.height || '150', 10),
        macdTF: document.getElementById('macd-tf')?.value || '5m',
        macdFast: parseInt(document.getElementById('macd-fast')?.value || '12', 10),
        macdSlow: parseInt(document.getElementById('macd-slow')?.value || '26', 10),
        macdSig: parseInt(document.getElementById('macd-sig')?.value || '9', 10),
        showStochRSI: document.getElementById('toggle-stoch-rsi')?.checked || false,
        stochHeight: parseInt(document.getElementById('stoch-chart-container')?.style.height || '150', 10),
        stochTF: document.getElementById('stoch-tf')?.value || '5m',
        stochRsiLen: parseInt(document.getElementById('stoch-rsi-len')?.value || '14', 10),
        stochLen: parseInt(document.getElementById('stoch-len')?.value || '14', 10),
        stochK: parseInt(document.getElementById('stoch-k')?.value || '3', 10),
        stochD: parseInt(document.getElementById('stoch-d')?.value || '3', 10)
    };
    localStorage.setItem('cats_ui_config', JSON.stringify(uiConfig));
}

function loadUIConfig() {
    try {
        const saved = localStorage.getItem('cats_ui_config');
        if (saved) {
            const config = JSON.parse(saved);
            if (typeof config.showMA === 'boolean') document.getElementById('toggle-ma').checked = config.showMA;
            if (typeof config.showBB === 'boolean') document.getElementById('toggle-bb').checked = config.showBB;
            if (config.maPeriod) {
                document.getElementById('ma-length').value = config.maPeriod;
                maPeriod = config.maPeriod;
            }
            if (typeof config.showWT === 'boolean') {
                document.getElementById('toggle-wt').checked = config.showWT;
            } else {
                document.getElementById('toggle-wt').checked = true;
            }
            if (config.wtHeight) {
                document.getElementById('wt-chart-container').style.height = `${config.wtHeight}px`;
            }
            if (config.wtN1 && document.getElementById('wt-n1')) {
                document.getElementById('wt-n1').value = config.wtN1;
                WT_CHANNEL_LEN = config.wtN1;
            }
            if (config.wtN2 && document.getElementById('wt-n2')) {
                document.getElementById('wt-n2').value = config.wtN2;
                WT_AVG_LEN = config.wtN2;
            }
            if (config.wtSig && document.getElementById('wt-sig')) {
                document.getElementById('wt-sig').value = config.wtSig;
                WT_SIG_LEN = config.wtSig;
            }
            if (config.wtOb && document.getElementById('wt-ob')) {
                document.getElementById('wt-ob').value = config.wtOb;
                WT_OB_LEVEL = config.wtOb;
            }
            if (typeof config.showSupertrend === 'boolean' && document.getElementById('toggle-supertrend')) {
                document.getElementById('toggle-supertrend').checked = config.showSupertrend;
            }
            if (config.supertrendPeriod && document.getElementById('supertrend-period')) {
                document.getElementById('supertrend-period').value = config.supertrendPeriod;
                supertrendPeriod = config.supertrendPeriod;
            }
            if (config.supertrendMultiplier && document.getElementById('supertrend-multiplier')) {
                document.getElementById('supertrend-multiplier').value = config.supertrendMultiplier;
                supertrendMultiplier = config.supertrendMultiplier;
            }
            if (typeof config.showMACD === 'boolean' && document.getElementById('toggle-macd')) {
                document.getElementById('toggle-macd').checked = config.showMACD;
            }
            if (config.macdHeight && document.getElementById('macd-chart-container')) {
                document.getElementById('macd-chart-container').style.height = `${config.macdHeight}px`;
            }
            if (config.macdTF && document.getElementById('macd-tf')) {
                document.getElementById('macd-tf').value = config.macdTF;
                MACD_TF = config.macdTF;
            }
            if (config.macdFast && document.getElementById('macd-fast')) {
                document.getElementById('macd-fast').value = config.macdFast;
                MACD_FAST = config.macdFast;
            }
            if (config.macdSlow && document.getElementById('macd-slow')) {
                document.getElementById('macd-slow').value = config.macdSlow;
                MACD_SLOW = config.macdSlow;
            }
            if (config.macdSig && document.getElementById('macd-sig')) {
                document.getElementById('macd-sig').value = config.macdSig;
                MACD_SIG = config.macdSig;
            }
            if (typeof config.showStochRSI === 'boolean' && document.getElementById('toggle-stoch-rsi')) {
                document.getElementById('toggle-stoch-rsi').checked = config.showStochRSI;
            }
            if (config.stochHeight && document.getElementById('stoch-chart-container')) {
                document.getElementById('stoch-chart-container').style.height = `${config.stochHeight}px`;
            }
            if (config.stochTF && document.getElementById('stoch-tf')) {
                document.getElementById('stoch-tf').value = config.stochTF;
                STOCH_TF = config.stochTF;
            }
            if (config.stochRsiLen && document.getElementById('stoch-rsi-len')) {
                document.getElementById('stoch-rsi-len').value = config.stochRsiLen;
                STOCH_RSI_LEN = config.stochRsiLen;
            }
            if (config.stochLen && document.getElementById('stoch-len')) {
                document.getElementById('stoch-len').value = config.stochLen;
                STOCH_LEN = config.stochLen;
            }
            if (config.stochK && document.getElementById('stoch-k')) {
                document.getElementById('stoch-k').value = config.stochK;
                STOCH_K = config.stochK;
            }
            if (config.stochD && document.getElementById('stoch-d')) {
                document.getElementById('stoch-d').value = config.stochD;
                STOCH_D = config.stochD;
            }
        }
    } catch (e) { }
}

document.addEventListener('DOMContentLoaded', init);
