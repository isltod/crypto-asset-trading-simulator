// API Endpoints
const basePath = window.location.pathname.replace(/\/$/, '');
const API_URL = basePath + '/api';
const WS_URL = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + window.location.pathname;
const BINANCE_REST_URL = 'https://api.binance.com/api/v3'; // Still used for historical bulk klines

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

function applyWTMarkers() {
    const toggleWT = document.getElementById('toggle-wt');
    if (!toggleWT || !candleSeries || !wt1Series) return;

    if (!toggleWT.checked) {
        candleSeries.setMarkers([]);
        wt1Series.setMarkers([]);
        return;
    }

    const formattedData = window.klineData;
    const wtData = window.lastWtData;
    if (!formattedData || !wtData || !wtData.wt1Data || !wtData.wt2Data) return;

    const markers = [];
    const wtMarkers = [];
    const len = formattedData.length;

    for (let i = 1; i < len; i++) {
        const prevWt1 = wtData.wt1Data[i - 1].value;
        const prevWt2 = wtData.wt2Data[i - 1].value;
        const currWt1 = wtData.wt1Data[i].value;
        const currWt2 = wtData.wt2Data[i].value;

        if (prevWt1 === undefined || prevWt2 === undefined || currWt1 === undefined || currWt2 === undefined) {
            continue;
        }

        const time = formattedData[i].time;

        // Long Signal: wt1 crosses above wt2 and wt1 < -WT_OB_LEVEL
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
        }
        // Short Signal: wt1 crosses below wt2 and wt1 > WT_OB_LEVEL
        else if (prevWt1 > prevWt2 && currWt1 < currWt2 && currWt1 > WT_OB_LEVEL) {
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

    candleSeries.setMarkers(markers);
    wt1Series.setMarkers(wtMarkers);
}

function updateWTPriceLines() {
    wtPriceLines.forEach(line => {
        try {
            wt1Series.removePriceLine(line);
        } catch(e) {}
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
    } catch (e) {}
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
    if(!authToken) return;
    const wtN1 = parseInt(document.getElementById('wt-n1')?.value || WT_CHANNEL_LEN, 10);
    const wtN2 = parseInt(document.getElementById('wt-n2')?.value || WT_AVG_LEN, 10);
    const wtSig = parseInt(document.getElementById('wt-sig')?.value || WT_SIG_LEN, 10);
    const wtOb = parseInt(document.getElementById('wt-ob')?.value || WT_OB_LEVEL, 10);
    
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
            symbol: currentSymbol
        });
        autoTradeEnabled = toggleAutoTrade ? toggleAutoTrade.checked : false;
        signalType = signalSelect ? signalSelect.value : 'none';
        updateBotState();
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
        applyWTMarkers();
    };
    toggleWT.addEventListener('change', updateWTVisibility);

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

    // Resizer Dragging Logic
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const startResize = (clientY) => {
        isResizing = true;
        startY = clientY;
        startHeight = wtContainer.clientHeight;
        document.body.style.cursor = 'row-resize';
        resizer.classList.add('resizing');
    };

    const doResize = (clientY) => {
        if (!isResizing) return;
        const dy = clientY - startY;
        let newHeight = startHeight - dy;
        if (newHeight < 60) newHeight = 60;
        if (newHeight > 500) newHeight = 500;
        wtContainer.style.height = `${newHeight}px`;
    };

    const stopResize = () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            resizer.classList.remove('resizing');
            saveUIConfig();
        }
    };

    resizer.addEventListener('mousedown', (e) => {
        startResize(e.clientY);
        e.preventDefault();
    });

    resizer.addEventListener('touchstart', (e) => {
        if (e.touches.length > 0) {
            startResize(e.touches[0].clientY);
            e.preventDefault();
        }
    }, { passive: false });

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
        if(authToken) {
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

    updateWTVisibility();
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

    // Sync time scales
    chart.timeScale().subscribeVisibleLogicalRangeChange(logicalRange => {
        wtChart.timeScale().setVisibleLogicalRange(logicalRange);
    });
    wtChart.timeScale().subscribeVisibleLogicalRangeChange(logicalRange => {
        chart.timeScale().setVisibleLogicalRange(logicalRange);
    });

    // Sync crosshairs bidirectionally
    let isSyncingCrosshair = false;
    chart.subscribeCrosshairMove(param => {
        if (isSyncingCrosshair) return;
        isSyncingCrosshair = true;
        try {
            if (!param || !param.time || !param.point) {
                wtChart.clearCrosshairPosition();
            } else {
                const time = param.time;
                let price = 0;
                if (window.lastWtData && window.lastWtData.wt1Data) {
                    const match = window.lastWtData.wt1Data.find(d => d.time === time);
                    if (match && match.value !== undefined) {
                        price = match.value;
                    }
                }
                wtChart.setCrosshairPosition(price, time, wt1Series);
            }
        } catch (e) {
            console.error(e);
        } finally {
            isSyncingCrosshair = false;
        }
    });

    wtChart.subscribeCrosshairMove(param => {
        if (isSyncingCrosshair) return;
        isSyncingCrosshair = true;
        try {
            if (!param || !param.time || !param.point) {
                chart.clearCrosshairPosition();
            } else {
                const time = param.time;
                let price = 0;
                if (window.klineData) {
                    const match = window.klineData.find(d => d.time === time);
                    if (match) {
                        price = match.close;
                    }
                }
                chart.setCrosshairPosition(price, time, candleSeries);
            }
        } catch (e) {
            console.error(e);
        } finally {
            isSyncingCrosshair = false;
        }
    });
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

    const wtData = calculateWaveTrend(formattedData);
    window.lastWtData = wtData;
    wt1Series.setData(wtData.wt1Data);
    wt2Series.setData(wtData.wt2Data);
    applyWTMarkers();
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
    applyWTMarkers();
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
        showBB: document.getElementById('toggle-bb').checked,
        showWT: document.getElementById('toggle-wt').checked,
        wtHeight: parseInt(document.getElementById('wt-chart-container').style.height || '150', 10),
        wtN1: parseInt(document.getElementById('wt-n1')?.value || '10', 10),
        wtN2: parseInt(document.getElementById('wt-n2')?.value || '21', 10),
        wtSig: parseInt(document.getElementById('wt-sig')?.value || '4', 10),
        wtOb: parseInt(document.getElementById('wt-ob')?.value || '53', 10)
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
        }
    } catch(e) {}
}

document.addEventListener('DOMContentLoaded', init);
