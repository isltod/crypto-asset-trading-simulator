// Binance Futures API endpoints
const REST_URL = 'https://fapi.binance.com/fapi/v1';
const WS_URL = 'wss://fstream.binance.com/ws';

// DOM Elements
const symbolSelect = document.getElementById('symbol-select');
const chartContainer = document.getElementById('chart-container');
const currentPriceEl = document.getElementById('current-price');
const priceChangeEl = document.getElementById('price-change');
const btnLong = document.getElementById('btn-long');
const btnShort = document.getElementById('btn-short');
const btnClose = document.getElementById('btn-close');
const activePosInfo = document.getElementById('active-position-info');
const posSideEl = document.getElementById('pos-side');
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

// Active Position State
let activePosition = null;
let tradeHistory = [];

// TPSL State
let tpslEnabled = false;
let tpRoi = 10;
let slRoi = -5;

const BB_PERIOD = 20;
const BB_STD_DEV = 2;

// Persistence
function saveConfig() {
    const config = {
        currentSymbol,
        maPeriod,
        virtualCapital,
        leverage,
        tpslEnabled,
        tpRoi,
        slRoi,
        activePosition,
        tradeHistory,
        showMA: document.getElementById('toggle-ma').checked,
        showBB: document.getElementById('toggle-bb').checked
    };
    localStorage.setItem('catsConfig', JSON.stringify(config));
}

function loadConfig() {
    const saved = localStorage.getItem('catsConfig');
    if (!saved) return;
    try {
        const config = JSON.parse(saved);
        if (config.currentSymbol) currentSymbol = config.currentSymbol;
        if (config.maPeriod) maPeriod = config.maPeriod;
        if (typeof config.virtualCapital === 'number') virtualCapital = config.virtualCapital;
        if (typeof config.leverage === 'number') leverage = config.leverage;
        if (typeof config.tpslEnabled === 'boolean') tpslEnabled = config.tpslEnabled;
        if (typeof config.tpRoi === 'number') tpRoi = config.tpRoi;
        if (typeof config.slRoi === 'number') slRoi = config.slRoi;
        if (config.activePosition !== undefined) activePosition = config.activePosition;
        if (config.tradeHistory !== undefined) tradeHistory = config.tradeHistory;

        // Update DOM Elements
        document.getElementById('ma-length').value = maPeriod;
        document.getElementById('capital-input').value = virtualCapital.toFixed(2);
        document.getElementById('leverage-input').value = leverage;
        document.getElementById('toggle-tpsl').checked = tpslEnabled;
        document.getElementById('tp-input').value = tpRoi;
        document.getElementById('sl-input').value = slRoi;

        if (typeof config.showMA === 'boolean') document.getElementById('toggle-ma').checked = config.showMA;
        if (typeof config.showBB === 'boolean') document.getElementById('toggle-bb').checked = config.showBB;

        // Restore active position UI
        if (activePosition) {
            btnLong.disabled = true;
            btnShort.disabled = true;
            activePosInfo.classList.remove('hidden');
            posSideEl.textContent = activePosition.side;
            posSideEl.style.color = activePosition.side === 'LONG' ? 'var(--up-color)' : 'var(--down-color)';
            posEntryEl.textContent = activePosition.entryPrice.toFixed(2);
            posMarginEl.textContent = activePosition.margin.toFixed(2) + " USDT";
            posSizeEl.textContent = activePosition.size.toFixed(4);
        }
    } catch (e) {
        console.error("Failed to load config", e);
    }
}

// Initialize function
async function init() {
    loadConfig();
    initChart();
    await loadSymbols();
    await loadChartData(currentSymbol);

    // Select change event listener
    symbolSelect.addEventListener('change', async (e) => {
        currentSymbol = e.target.value;
        saveConfig();
        await loadChartData(currentSymbol);
    });

    // Indicator toggles
    document.getElementById('toggle-ma').addEventListener('change', (e) => {
        if (maSeries) {
            maSeries.applyOptions({ visible: e.target.checked });
        }
        saveConfig();
    });

    // MA Length configuration
    document.getElementById('ma-length').addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 200) val = 200;
        e.target.value = val;
        maPeriod = val;
        saveConfig();

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
        saveConfig();
    });

    // Virtual Capital configuration
    document.getElementById('capital-input').addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val) || val < 0) val = 0;
        e.target.value = val;
        virtualCapital = val;
        saveConfig();
        console.log("Virtual Capital set to:", virtualCapital);
    });

    // Leverage configuration
    document.getElementById('leverage-input').addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 100) val = 100;
        e.target.value = val;
        leverage = val;
        saveConfig();
        console.log("Leverage set to:", leverage);
    });

    // TPSL Configuration
    document.getElementById('toggle-tpsl').addEventListener('change', (e) => {
        tpslEnabled = e.target.checked;
        saveConfig();
        console.log("TPSL Enabled:", tpslEnabled);
    });

    document.getElementById('tp-input').addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        else val = Math.abs(val);
        e.target.value = val;
        tpRoi = val;
        saveConfig();
        console.log("Take Profit set to:", tpRoi, "%");
    });

    document.getElementById('sl-input').addEventListener('change', (e) => {
        let val = parseFloat(e.target.value);
        if (isNaN(val)) val = 0;
        else val = -Math.abs(val);
        e.target.value = val;
        slRoi = val;
        saveConfig();
        console.log("Stop Loss set to:", slRoi, "%");
    });

    // Trading Execution
    btnLong.addEventListener('click', () => openPosition('LONG'));
    btnShort.addEventListener('click', () => openPosition('SHORT'));
    btnClose.addEventListener('click', () => closePosition());

    // History Modal Controls
    btnHistory.addEventListener('click', () => {
        renderHistoryTable();
        historyModal.classList.remove('hidden');
    });

    btnCloseHistory.addEventListener('click', () => {
        historyModal.classList.add('hidden');
    });

    btnClearHistory.addEventListener('click', () => {
        if (tradeHistory.length === 0) {
            alert("기록된 거래 내역이 없습니다.");
            return;
        }
        confirmModal.classList.remove('hidden');
    });

    btnConfirmCancel.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
    });

    btnConfirmOk.addEventListener('click', () => {
        confirmModal.classList.add('hidden');
        tradeHistory = [];
        saveConfig();
        renderHistoryTable();
    });

    btnExportCsv.addEventListener('click', async () => {
        if (tradeHistory.length === 0) {
            alert("No trade history to export.");
            return;
        }

        const headers = ["Side", "Entry Time", "Exit Time", "Entry Price", "Exit Price", "PnL", "ROE", "Fee", "Capital Before", "Capital After"];
        const rows = tradeHistory.map(row => {
            const formatDate = (ts) => {
                const d = new Date(ts);
                const YYYY = d.getFullYear();
                const MM = String(d.getMonth() + 1).padStart(2, '0');
                const DD = String(d.getDate()).padStart(2, '0');
                const HH = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const ss = String(d.getSeconds()).padStart(2, '0');
                return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
            };
            return [
                row.side,
                formatDate(row.entryTime),
                formatDate(row.exitTime),
                row.entryPrice.toFixed(2),
                row.exitPrice.toFixed(2),
                row.pnl.toFixed(2),
                `${row.roe.toFixed(2)}%`,
                row.fee.toFixed(2),
                row.capitalBefore.toFixed(2),
                row.capitalAfter.toFixed(2)
            ].join(',');
        });

        // Add BOM for correct UTF-8 in Excel
        const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const csvString = [headers.join(','), ...rows].join(String.fromCharCode(10));
        const blob = new Blob([BOM, csvString], { type: 'text/csv;charset=utf-8' });

        const d = new Date();
        const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
        const defaultFilename = `trade_history_${dateStr}.csv`;

        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: defaultFilename,
                    types: [{
                        description: 'CSV File',
                        accept: { 'text/csv': ['.csv'] }
                    }]
                });
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.error('File save failed:', err);
                }
            }
        } else {
            // Fallback for older browsers
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", defaultFilename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        }
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

            // Real-time Position / PnL / TPSL check
            if (activePosition) {
                updatePosition(tick.close);
            }

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

// Trading Execution Logic
function openPosition(side) {
    if (activePosition) {
        alert("A position is already open.");
        return;
    }
    if (virtualCapital <= 0) {
        alert("Insufficient capital. Change the Capital value at the top.");
        return;
    }
    if (lastClose <= 0) return;

    const margin = virtualCapital;
    const entryPrice = lastClose;
    const size = (margin * leverage) / entryPrice;

    // 거래 수수료 차감 (진입 시): 0.05% * 레버리지 적용된 포지션 규모
    const feeRate = 0.0005;
    const entryFee = margin * leverage * feeRate;
    const capitalBefore = virtualCapital; // 기록용 (거래요금 차감 전 원금)

    virtualCapital -= entryFee;
    document.getElementById('capital-input').value = virtualCapital.toFixed(2);

    activePosition = {
        side: side,
        entryPrice: entryPrice,
        margin: margin,
        leverage: leverage,
        size: size,
        entryTime: Date.now(),
        capitalBefore: capitalBefore,
        entryFee: entryFee
    };

    // Update UI
    btnLong.disabled = true;
    btnShort.disabled = true;
    activePosInfo.classList.remove('hidden');

    posSideEl.textContent = side;
    posSideEl.style.color = side === 'LONG' ? 'var(--up-color)' : 'var(--down-color)';
    posEntryEl.textContent = entryPrice.toFixed(2);
    posMarginEl.textContent = margin.toFixed(2) + " USDT";
    posSizeEl.textContent = size.toFixed(4);

    updatePosition(entryPrice);
    saveConfig();
    console.log(`[TRADE] Opened ${side} position: Entry ${entryPrice}, Margin ${margin}, Lev ${leverage}x`);
}

function closePosition() {
    if (!activePosition) return;

    const { pnl, roe } = calculatePnL(lastClose);

    // 거래 수수료 차감 (청산 시): 0.05% * 현재 가격 기준 포지션 규모
    const feeRate = 0.0005;
    const closingValue = lastClose * activePosition.size;
    const closeFee = closingValue * feeRate;

    const totalFee = activePosition.entryFee + closeFee;

    // Update balance
    virtualCapital += pnl;
    virtualCapital -= closeFee;

    if (virtualCapital < 0) virtualCapital = 0;

    const exitTime = Date.now();
    const historyRecord = {
        side: activePosition.side,
        entryTime: activePosition.entryTime,
        exitTime: exitTime,
        entryPrice: activePosition.entryPrice,
        exitPrice: lastClose,
        pnl: pnl,
        roe: roe,
        fee: totalFee,
        capitalBefore: activePosition.capitalBefore,
        capitalAfter: virtualCapital
    };

    tradeHistory.push(historyRecord);
    renderHistoryTable();

    document.getElementById('capital-input').value = virtualCapital.toFixed(2);

    console.log(`[TRADE] Closed position. PnL: ${pnl.toFixed(2)} USDT, Close Fee: ${closeFee.toFixed(2)} USDT. New Capital: ${virtualCapital.toFixed(2)}`);

    // Reset state & UI
    activePosition = null;
    btnLong.disabled = false;
    btnShort.disabled = false;
    activePosInfo.classList.add('hidden');
    saveConfig();
}

function calculatePnL(currentPrice) {
    if (!activePosition) return { pnl: 0, roe: 0 };

    let pnl = 0;
    let priceMovePct = 0;

    if (activePosition.side === 'LONG') {
        pnl = (currentPrice - activePosition.entryPrice) * activePosition.size;
        priceMovePct = ((currentPrice - activePosition.entryPrice) / activePosition.entryPrice) * 100;
    } else {
        pnl = (activePosition.entryPrice - currentPrice) * activePosition.size;
        priceMovePct = ((activePosition.entryPrice - currentPrice) / activePosition.entryPrice) * 100;
    }

    // 수익률(ROE) = 자산 변동률 * 레버리지
    const roe = priceMovePct * activePosition.leverage;
    return { pnl, roe };
}

function updatePosition(currentPrice) {
    if (!activePosition) return;

    const { pnl, roe } = calculatePnL(currentPrice);

    posPnlEl.textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`;
    posPnlEl.className = `pnl-val ${pnl >= 0 ? 'up' : 'down'}`;

    posRoeEl.textContent = `${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%`;
    posRoeEl.className = `pnl-val ${roe >= 0 ? 'up' : 'down'}`;

    // Liquidation Check
    if (roe <= -100) {
        console.log("[LIQUIDATION] Position margin exhausted.");
        closePosition();
        return;
    }

    // TPSL triggers
    if (tpslEnabled) {
        if (roe >= tpRoi) {
            console.log(`[TPSL] Take Profit triggered! ROE: ${roe.toFixed(2)}% >= ${tpRoi}%`);
            closePosition();
        } else if (roe <= slRoi) {
            console.log(`[TPSL] Stop Loss triggered! ROE: ${roe.toFixed(2)}% <= ${slRoi}%`);
            closePosition();
        }
    }
}

function renderHistoryTable() {
    historyTbody.innerHTML = '';
    if (tradeHistory.length === 0) {
        historyTbody.innerHTML = '<tr><td colspan="10" style="text-align: center;">No completed trades yet.</td></tr>';
        return;
    }

    // Render latest trades first (reverse loop)
    for (let i = tradeHistory.length - 1; i >= 0; i--) {
        const row = tradeHistory[i];
        const tr = document.createElement('tr');

        const formatDate = (ts) => {
            const d = new Date(ts);
            const YYYY = d.getFullYear();
            const MM = String(d.getMonth() + 1).padStart(2, '0');
            const DD = String(d.getDate()).padStart(2, '0');
            const HH = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return `${YYYY}-${MM}-${DD} ${HH}:${mm}:${ss}`;
        };

        const pnlClass = row.pnl >= 0 ? 'up' : 'down';

        tr.innerHTML = `
            <td class="${row.side}">${row.side}</td>
            <td>${formatDate(row.entryTime)}</td>
            <td>${formatDate(row.exitTime)}</td>
            <td>${row.entryPrice.toFixed(2)}</td>
            <td>${row.exitPrice.toFixed(2)}</td>
            <td class="${pnlClass}">${row.pnl > 0 ? '+' : ''}${row.pnl.toFixed(2)}</td>
            <td class="${pnlClass}">${row.roe > 0 ? '+' : ''}${row.roe.toFixed(2)}%</td>
            <td>${row.fee.toFixed(2)}</td>
            <td>${row.capitalBefore.toFixed(2)}</td>
            <td>${row.capitalAfter.toFixed(2)}</td>
        `;
        historyTbody.appendChild(tr);
    }
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
