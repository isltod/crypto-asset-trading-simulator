// API Endpoints
const basePath = window.location.pathname.replace(/\/$/, '');
const API_URL = basePath + '/api';
const WS_URL = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + window.location.pathname;
const BINANCE_REST_URL = 'https://fapi.binance.com/fapi/v1'; // Still used for historical bulk klines

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
        
        document.getElementById('capital-input').value = virtualCapital.toFixed(2);
        document.getElementById('leverage-input').value = leverage;
        document.getElementById('toggle-tpsl').checked = tpslEnabled;
        document.getElementById('tp-input').value = tpRoi;
        document.getElementById('sl-input').value = slRoi;

        if (data.activePosition) {
            activePosition = data.activePosition;
            renderActivePosition();
        } else {
            activePosition = null;
            activePosInfo.classList.add('hidden');
        }
    } catch (e) {}
}

async function fetchHistory() {
    if (!authToken) return;
    try {
        tradeHistory = await apiCall('/history');
    } catch(e) {}
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

    // Set up Auth bindings
    btnOpenLogin.addEventListener('click', () => {
        authModal.classList.remove('hidden');
    });
    btnCloseAuth.addEventListener('click', () => {
        authModal.classList.add('hidden');
    });
    btnLogout.addEventListener('click', handleLogout);
    
    btnRecharge.addEventListener('click', async () => {
        if(!authToken) return;
        const newCap = parseFloat(document.getElementById('capital-input').value);
        if(isNaN(newCap) || newCap < 0) return alert('Invalid capital amount');

        try {
            const res = await apiCall('/account/recharge', 'POST', { virtual_capital: newCap });
            document.getElementById('capital-input').value = res.virtual_capital.toFixed(2);
            virtualCapital = res.virtual_capital;
            alert(`Capital has been set to ${res.virtual_capital} USDT`);
        } catch(e) {}
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
        if(!username || !password) return alert('Enter credentials');
        
        const endpoint = isLoginMode ? '/auth/login' : '/auth/register';
        try {
            const res = await apiCall(endpoint, 'POST', {username, password});
            if(isLoginMode) {
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
        } catch(e) {}
    });

    // Config updating
    const updateConfig = async () => {
        if(!authToken) return;
        await apiCall('/account/config', 'POST', {
            leverage: parseInt(document.getElementById('leverage-input').value) || 1,
            tpsl_enabled: document.getElementById('toggle-tpsl').checked,
            tp_roi: parseFloat(document.getElementById('tp-input').value) || 10,
            sl_roi: parseFloat(document.getElementById('sl-input').value) || -5
        });
    };

    document.getElementById('leverage-input').addEventListener('change', updateConfig);
    document.getElementById('toggle-tpsl').addEventListener('change', updateConfig);
    document.getElementById('tp-input').addEventListener('change', updateConfig);
    document.getElementById('sl-input').addEventListener('change', updateConfig);

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

    btnClearHistory.addEventListener('click', () => {
        if (tradeHistory.length === 0) return alert("기록된 거래 내역이 없습니다.");
        confirmModal.classList.remove('hidden');
    });

    btnConfirmCancel.addEventListener('click', () => confirmModal.classList.add('hidden'));

    btnConfirmOk.addEventListener('click', async () => {
        confirmModal.classList.add('hidden');
        if(authToken) {
            await apiCall('/history', 'DELETE');
        }
        tradeHistory = [];
        renderHistoryTable();
    });

    symbolSelect.addEventListener('change', async (e) => {
        currentSymbol = e.target.value;
        await loadChartData(currentSymbol);
    });

    const resizeObserver = new ResizeObserver(entries => {
        if (!chart) return;
        const { width, height } = entries[0].contentRect;
        chart.applyOptions({ width, height });
    });
    resizeObserver.observe(chartContainer);
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
        rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.1)' },
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
}

async function loadSymbols() {
    try {
        const response = await fetch(`${BINANCE_REST_URL}/exchangeInfo`);
        const data = await response.json();
        const symbols = data.symbols.filter(s => s.quoteAsset === 'USDT' && s.contractType === 'PERPETUAL' && s.status === 'TRADING').map(s => s.symbol).sort();
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
        const response = await fetch(`${BINANCE_REST_URL}/klines?symbol=${symbol}&interval=1m&limit=1000`);
        const data = await response.json();
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
            updatePriceDisplay(tick.close, lastClose);

            if (activePosition && authToken) {
                updateVisualPnL(tick.close);
            }

            lastClose = tick.close;
        }

        // Backend Event: Auto Liquidated or TPSL hits
        if (message.type === 'position_closed') {
            alert(`Position automatically closed! PnL: ${message.data.pnl.toFixed(2)}`);
            activePosition = null;
            document.getElementById('capital-input').value = message.data.newCapital.toFixed(2);
            activePosInfo.classList.add('hidden');
            btnLong.disabled = false;
            btnShort.disabled = false;
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
    } catch(e) {}
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
    } catch(e) {}
}

function renderActivePosition() {
    btnLong.disabled = true;
    btnShort.disabled = true;
    activePosInfo.classList.remove('hidden');
    posSideEl.textContent = activePosition.side;
    posSideEl.style.color = activePosition.side === 'LONG' ? 'var(--up-color)' : 'var(--down-color)';
    posEntryEl.textContent = activePosition.entry_price.toFixed(2);
    posMarginEl.textContent = activePosition.margin.toFixed(2) + " USDT";
    posSizeEl.textContent = activePosition.size.toFixed(4);
    updateVisualPnL(lastClose);
}

function updateVisualPnL(currentPrice) {
    if(!activePosition || !currentPrice) return;
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
        showBB: document.getElementById('toggle-bb').checked
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
        }
    } catch(e) {}
}

document.addEventListener('DOMContentLoaded', init);
