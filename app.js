// Binance Futures API endpoints
const REST_URL = 'https://fapi.binance.com/fapi/v1';
const WS_URL = 'wss://fstream.binance.com/ws';

// DOM Elements
const symbolSelect = document.getElementById('symbol-select');
const chartContainer = document.getElementById('chart-container');
const currentPriceEl = document.getElementById('current-price');
const priceChangeEl = document.getElementById('price-change');

// State
let currentSymbol = 'BTCUSDT';
let chart = null;
let candleSeries = null;
let maSeries = null;
let bbUpperSeries = null;
let bbLowerSeries = null;
let bbMiddleSeries = null; // optional visibility
let ws = null;
let lastClose = 0;
let maPeriod = 20;
let virtualCapital = 100;
let leverage = 1;

// TPSL State
let tpslEnabled = false;
let tpRoi = 10;
let slRoi = -5;

const BB_PERIOD = 20;
const BB_STD_DEV = 2;

// Initialize function
async function init() {
    initChart();
    await loadSymbols();
    await loadChartData(currentSymbol);

    // Select change event listener
    symbolSelect.addEventListener('change', async (e) => {
        currentSymbol = e.target.value;
        await loadChartData(currentSymbol);
    });

    // Indicator toggles
    document.getElementById('toggle-ma').addEventListener('change', (e) => {
        if (maSeries) {
            maSeries.applyOptions({ visible: e.target.checked });
        }
    });

    // MA Length configuration
    document.getElementById('ma-length').addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 200) val = 200;
        e.target.value = val;
        maPeriod = val;

        // Recalculate and redraw series
        if (window.klineData && window.klineData.length > 0) {
            updateChartSeries();
        }
    });

    document.getElementById('toggle-bb').addEventListener('change', (e) => {
        const isVisible = e.target.checked;
        if (bbUpperSeries) bbUpperSeries.applyOptions({ visible: isVisible });
        if (bbLowerSeries) bbLowerSeries.applyOptions({ visible: isVisible });
        if (bbMiddleSeries) bbMiddleSeries.applyOptions({ visible: isVisible });
    });

    // Virtual Capital configuration
    document.getElementById('capital-input').addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val) || val < 0) val = 0;
        e.target.value = val;
        virtualCapital = val;
        console.log("Virtual Capital set to:", virtualCapital);
    });

    // Leverage configuration
    document.getElementById('leverage-input').addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 100) val = 100;
        e.target.value = val;
        leverage = val;
        console.log("Leverage set to:", leverage);
    });

    // TPSL Configuration
    document.getElementById('toggle-tpsl').addEventListener('change', (e) => {
        tpslEnabled = e.target.checked;
        console.log("TPSL Enabled:", tpslEnabled);
    });

    document.getElementById('tp-input').addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        else val = Math.abs(val);
        e.target.value = val;
        tpRoi = val;
        console.log("Take Profit set to:", tpRoi, "%");
    });

    document.getElementById('sl-input').addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        else val = -Math.abs(val);
        e.target.value = val;
        slRoi = val;
        console.log("Stop Loss set to:", slRoi, "%");
    });

    // Handle Window Resize via ResizeObserver to make it rock solid
    const resizeObserver = new ResizeObserver(entries => {
        if (!chart) return;
        const { width, height } = entries[0].contentRect;
        chart.applyOptions({ width, height });
    });
    resizeObserver.observe(chartContainer);
}

// Ensure chart container is sized properly before creating chart
function initChart() {
    console.log("chart container sizing:", chartContainer.clientWidth, chartContainer.clientHeight);
    chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth || 600,
        height: chartContainer.clientHeight || 400,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: '#94a3b8',
        },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                width: 1,
                color: 'rgba(255, 255, 255, 0.4)',
                style: LightweightCharts.LineStyle.Dashed,
            },
            horzLine: {
                width: 1,
                color: 'rgba(255, 255, 255, 0.4)',
                style: LightweightCharts.LineStyle.Dashed,
            },
        },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
        },
        timeScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            timeVisible: true,
            secondsVisible: false,
        },
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#2ebd85',
        downColor: '#f6465d',
        borderDownColor: '#f6465d',
        borderUpColor: '#2ebd85',
        wickDownColor: '#f6465d',
        wickUpColor: '#2ebd85',
    });

    // Add Moving Average Series
    maSeries = chart.addLineSeries({
        color: '#f59e0b', // Amber/Gold color
        lineWidth: 2,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: document.getElementById('toggle-ma').checked,
    });

    // Add Bollinger Bands Series
    bbUpperSeries = chart.addLineSeries({
        color: 'rgba(56, 189, 248, 0.5)', // Light Blueish
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: document.getElementById('toggle-bb').checked,
    });

    bbMiddleSeries = chart.addLineSeries({
        color: 'rgba(56, 189, 248, 0.5)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: document.getElementById('toggle-bb').checked,
    });

    bbLowerSeries = chart.addLineSeries({
        color: 'rgba(56, 189, 248, 0.5)',
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        visible: document.getElementById('toggle-bb').checked,
    });
}

// Load USDT Perpetual Symbols
async function loadSymbols() {
    try {
        const response = await fetch(`${REST_URL}/exchangeInfo`);
        const data = await response.json();

        // Filter out only USDT margin perpetual futures that are actively trading
        const symbols = data.symbols
            .filter(s => s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL' && s.status === 'TRADING')
            .map(s => s.symbol)
            .sort();

        // Populate dropdown
        symbolSelect.innerHTML = '';
        symbols.forEach(sym => {
            const option = document.createElement('option');
            option.value = sym;
            option.textContent = sym;
            if (sym === currentSymbol) {
                option.selected = true;
            }
            symbolSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading symbols:', error);
        currentPriceEl.textContent = 'Network Error';
    }
}

// Load Historical Data
async function loadChartData(symbol) {
    if (ws) {
        ws.close();
        ws = null;
    }

    try {
        // Show loading state
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay active';
        overlay.id = 'loading-overlay';
        overlay.innerHTML = '<div class="spinner"></div>';
        chartContainer.appendChild(overlay);

        // Fetch 1m klines, limit 1000 so we have enough data for BB / MA calculations
        const response = await fetch(`${REST_URL}/klines?symbol=${symbol}&interval=1m&limit=1000`);
        const data = await response.json();

        // Used as raw state array to calculate indicators dynamically later
        window.klineData = data.map(d => ({
            time: Math.floor(d[0] / 1000),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4])
        }));

        updateChartSeries();

        const lastCandle = window.klineData[window.klineData.length - 1];
        lastClose = lastCandle.close;

        updatePriceDisplay(lastClose, window.klineData[window.klineData.length - 2]?.close || lastClose);

        // Remove loading state
        const existingOverlay = document.getElementById('loading-overlay');
        if (existingOverlay) chartContainer.removeChild(existingOverlay);

        // Start WebSocket for real-time updates
        connectWebSocket(symbol);
    } catch (error) {
        console.error('Error loading chart data:', error);
        const existingOverlay = document.getElementById('loading-overlay');
        if (existingOverlay) chartContainer.removeChild(existingOverlay);
        currentPriceEl.textContent = 'Error loading data';
    }
}

// Update all series data
function updateChartSeries() {
    const formattedData = window.klineData;

    // Dynamically adjust price format based on asset price (e.g. SHIB vs BTC)
    const lastCandle = formattedData[formattedData.length - 1];
    if (!lastCandle) return;

    let precision = 2;
    if (lastCandle.close < 0.001) precision = 6;
    else if (lastCandle.close < 0.1) precision = 5;
    else if (lastCandle.close < 1) precision = 4;
    else if (lastCandle.close < 10) precision = 3;

    candleSeries.applyOptions({
        priceFormat: {
            type: 'price',
            precision: precision,
            minMove: 1 / Math.pow(10, precision),
        }
    });

    candleSeries.setData(formattedData);

    // Calculate MA
    const maData = [];
    for (let i = 0; i < formattedData.length; i++) {
        if (i < maPeriod - 1) continue;
        let sum = 0;
        for (let j = 0; j < maPeriod; j++) {
            sum += formattedData[i - j].close;
        }
        maData.push({ time: formattedData[i].time, value: sum / maPeriod });
    }
    maSeries.setData(maData);

    // Calculate Bollinger Bands
    const bbUpperData = [];
    const bbLowerData = [];
    const bbMiddleData = [];

    for (let i = 0; i < formattedData.length; i++) {
        if (i < BB_PERIOD - 1) continue;
        let sum = 0;
        for (let j = 0; j < BB_PERIOD; j++) {
            sum += formattedData[i - j].close;
        }
        const sma = sum / BB_PERIOD;

        let varianceSum = 0;
        for (let j = 0; j < BB_PERIOD; j++) {
            varianceSum += Math.pow(formattedData[i - j].close - sma, 2);
        }
        const stdDev = Math.sqrt(varianceSum / BB_PERIOD);

        bbMiddleData.push({ time: formattedData[i].time, value: sma });
        bbUpperData.push({ time: formattedData[i].time, value: sma + (BB_STD_DEV * stdDev) });
        bbLowerData.push({ time: formattedData[i].time, value: sma - (BB_STD_DEV * stdDev) });
    }

    bbMiddleSeries.setData(bbMiddleData);
    bbUpperSeries.setData(bbUpperData);
    bbLowerSeries.setData(bbLowerData);
}

// Connect to Binance WebSocket for live kline updates
function connectWebSocket(symbol) {
    const streamName = `${symbol.toLowerCase()}@kline_1m`;
    ws = new WebSocket(`${WS_URL}/${streamName}`);

    ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.e === 'kline') {
            const kline = message.k;
            const tick = {
                time: Math.floor(kline.t / 1000),
                open: parseFloat(kline.o),
                high: parseFloat(kline.h),
                low: parseFloat(kline.l),
                close: parseFloat(kline.c)
            };

            candleSeries.update(tick);

            // Update raw data array for indicator calculation
            const lastExistingTick = window.klineData[window.klineData.length - 1];
            if (lastExistingTick && lastExistingTick.time === tick.time) {
                window.klineData[window.klineData.length - 1] = tick;
            } else {
                window.klineData.push(tick);
                if (window.klineData.length > 1500) window.klineData.shift(); // Keep memory usage low
            }

            // Real-time calculation for MA
            if (window.klineData.length >= maPeriod) {
                let sum = 0;
                for (let j = 0; j < maPeriod; j++) {
                    sum += window.klineData[window.klineData.length - 1 - j].close;
                }
                maSeries.update({ time: tick.time, value: sum / maPeriod });
            }

            // Real-time calculation for Bollinger Bands
            if (window.klineData.length >= BB_PERIOD) {
                let sum = 0;
                for (let j = 0; j < BB_PERIOD; j++) {
                    sum += window.klineData[window.klineData.length - 1 - j].close;
                }
                const sma = sum / BB_PERIOD;

                let varianceSum = 0;
                for (let j = 0; j < BB_PERIOD; j++) {
                    varianceSum += Math.pow(window.klineData[window.klineData.length - 1 - j].close - sma, 2);
                }
                const stdDev = Math.sqrt(varianceSum / BB_PERIOD);

                bbMiddleSeries.update({ time: tick.time, value: sma });
                bbUpperSeries.update({ time: tick.time, value: sma + (BB_STD_DEV * stdDev) });
                bbLowerSeries.update({ time: tick.time, value: sma - (BB_STD_DEV * stdDev) });
            }

            // Update UI with the current price
            updatePriceDisplay(tick.close, lastClose);
            lastClose = tick.close;
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
    };

    ws.onclose = () => {
        // Optional: Reconnect logic could be added here
        console.log('WebSocket connection closed.');
    };
}

// Update Price Header UI
function updatePriceDisplay(current, previous) {
    let formatStr = current.toString();

    // Convert to proper precision string depending on the size of the coin value
    if (formatStr.includes('e')) {
        formatStr = current.toFixed(8);
    } else if (current < 1) {
        formatStr = current.toFixed(5);
    }

    if (current > previous) {
        currentPriceEl.className = 'price up';
        // force reflow to restart CSS transitions/animations if we had ones
    } else if (current < previous) {
        currentPriceEl.className = 'price down';
    }

    currentPriceEl.textContent = formatStr;
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
