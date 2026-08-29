import { state } from './state.js';
import { 
    apiCall, 
    setLogoutHandler, 
    fetchAccountData, 
    saveAccountConfig, 
    rechargeCapital, 
    fetchTradeHistory, 
    clearTradeHistory, 
    openTrade, 
    closeTrade, 
    fetchBackendStatus, 
    fetchSymbols, 
    fetchKlines 
} from './api.js';
import { 
    initCharts, 
    updateChartSeries, 
    updateWTPriceLines, 
    updateStochPriceLines, 
    applyIndicatorMarkers, 
    renderSupertrend 
} from './chartManager.js';
import { connectWebSocket } from './websocket.js';
import { 
    updatePriceDisplay, 
    renderActivePosition, 
    renderHistoryTable, 
    exportHistoryCsv 
} from './tradeUI.js';
import { updateAuthUI, updateBotStateBadge } from './authUI.js';

// DOM Elements
const symbolSelect = document.getElementById('symbol-select');
const chartContainer = document.getElementById('chart-container');
const currentPriceEl = document.getElementById('current-price');
const btnLong = document.getElementById('btn-long');
const btnShort = document.getElementById('btn-short');
const btnClose = document.getElementById('btn-close');
const activePosInfo = document.getElementById('active-position-info');
const btnHistory = document.getElementById('btn-history');
const historyModal = document.getElementById('history-modal');
const btnCloseHistory = document.getElementById('btn-close-history');
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
const authToggleLink = document.getElementById('auth-toggle-link');
const authTitle = document.getElementById('auth-title');
const btnRecharge = document.getElementById('btn-recharge');

// Auto Trading DOM
const signalSelect = document.getElementById('signal-select');
const toggleAutoTrade = document.getElementById('toggle-autotrade');

// Mobile UI DOM
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const headerControls = document.getElementById('header-controls');
const authControls = document.getElementById('auth-controls');
const mobileTradeBtn = document.getElementById('mobile-trade-btn');
const tradePanel = document.getElementById('trade-panel');

function handleLogout() {
    state.authToken = null;
    state.currentUsername = null;
    localStorage.removeItem('cats_token');
    localStorage.removeItem('cats_username');
    state.activePosition = null;
    state.tradeHistory = [];
    state.ws?.close();

    state.autoTradeEnabled = false;
    state.signalType = 'none';
    if (signalSelect) {
        signalSelect.value = 'none';
        signalSelect.disabled = true;
    }
    if (toggleAutoTrade) {
        toggleAutoTrade.checked = false;
        toggleAutoTrade.disabled = true;
    }
    updateBotStateBadge();
    updateAuthUI();
    connectWebSocket(state.currentSymbol, loadAccountState);
}
setLogoutHandler(handleLogout);

async function loadSymbols() {
    try {
        const data = await fetchSymbols();
        const symbols = data.symbols.filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING').map(s => s.symbol).sort();
        symbolSelect.innerHTML = '';
        symbols.forEach(sym => {
            const option = document.createElement('option');
            option.value = sym;
            option.textContent = sym;
            if (sym === state.currentSymbol) option.selected = true;
            symbolSelect.appendChild(option);
        });
    } catch (e) {
        if (currentPriceEl) currentPriceEl.textContent = 'Network Error';
    }
}

async function loadChartData(symbol) {
    if (state.ws) { state.ws.close(); state.ws = null; }
    try {
        const data = await fetchKlines(symbol, '1m');
        if (!Array.isArray(data)) {
            throw new Error('Invalid kline response: ' + JSON.stringify(data));
        }

        state.klineData = data.map(d => ({
            time: Math.floor(d[0] / 1000), open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4])
        }));
        updateChartSeries();
        state.lastClose = state.klineData[state.klineData.length - 1].close;
        updatePriceDisplay(state.lastClose, state.klineData[state.klineData.length - 2]?.close || state.lastClose);
        connectWebSocket(symbol, loadAccountState);
    } catch (e) {
        console.error('loadChartData error:', e);
        if (currentPriceEl) currentPriceEl.textContent = 'Error loading data';
    }
}

async function loadAccountState() {
    if (!state.authToken) return;
    try {
        const data = await fetchAccountData();
        if (!data) return;
        const acc = data.account;

        state.virtualCapital = acc.virtual_capital;
        state.leverage = acc.leverage;
        state.tpslEnabled = acc.tpsl_enabled === 1;
        state.tpRoi = acc.tp_roi;
        state.slRoi = acc.sl_roi;
        state.autoTradeEnabled = acc.auto_trade_enabled === 1;
        state.signalType = acc.signal_type || 'none';

        state.WT_TF = acc.wt_tf || '5m';
        state.WT_CHANNEL_LEN = acc.wt_n1 || 10;
        state.WT_AVG_LEN = acc.wt_n2 || 21;
        state.WT_SIG_LEN = acc.wt_sig || 4;
        state.WT_OB_LEVEL = acc.wt_ob || 53;
        state.WT_ALLOW_REPAINT = acc.wt_allow_repaint === 1;
        state.WT_IGNORE_OBOS = acc.wt_ignore_obos === 1;

        state.MACD_TF = acc.macd_tf || '5m';
        state.MACD_FAST = acc.macd_fast || 12;
        state.MACD_SLOW = acc.macd_slow || 26;
        state.MACD_SIG = acc.macd_sig || 9;
        state.MACD_ALLOW_REPAINT = acc.macd_allow_repaint === 1;

        state.STOCH_TF = acc.stoch_tf || '5m';
        state.STOCH_RSI_LEN = acc.stoch_rsi_len || 14;
        state.STOCH_LEN = acc.stoch_len || 14;
        state.STOCH_K = acc.stoch_k || 3;
        state.STOCH_D = acc.stoch_d || 3;
        state.STOCH_ALLOW_REPAINT = acc.stoch_allow_repaint === 1;

        const wtTfInput = document.getElementById('wt-tf');
        if (wtTfInput) wtTfInput.value = state.WT_TF;
        const wtN1Input = document.getElementById('wt-n1');
        if (wtN1Input) wtN1Input.value = state.WT_CHANNEL_LEN;
        const wtN2Input = document.getElementById('wt-n2');
        if (wtN2Input) wtN2Input.value = state.WT_AVG_LEN;
        const wtSigInput = document.getElementById('wt-sig');
        if (wtSigInput) wtSigInput.value = state.WT_SIG_LEN;
        const wtObInput = document.getElementById('wt-ob');
        if (wtObInput) wtObInput.value = state.WT_OB_LEVEL;
        const wtRepaintInput = document.getElementById('wt-allow-repaint');
        if (wtRepaintInput) wtRepaintInput.checked = state.WT_ALLOW_REPAINT;
        const wtIgnoreObosInput = document.getElementById('wt-ignore-obos');
        if (wtIgnoreObosInput) wtIgnoreObosInput.checked = state.WT_IGNORE_OBOS;

        const macdTfInput = document.getElementById('macd-tf');
        if (macdTfInput) macdTfInput.value = state.MACD_TF;
        const macdFastInput = document.getElementById('macd-fast');
        if (macdFastInput) macdFastInput.value = state.MACD_FAST;
        const macdSlowInput = document.getElementById('macd-slow');
        if (macdSlowInput) macdSlowInput.value = state.MACD_SLOW;
        const macdSigInput = document.getElementById('macd-sig');
        if (macdSigInput) macdSigInput.value = state.MACD_SIG;
        const macdRepaintInput = document.getElementById('macd-allow-repaint');
        if (macdRepaintInput) macdRepaintInput.checked = state.MACD_ALLOW_REPAINT;

        const stochTfInput = document.getElementById('stoch-tf');
        if (stochTfInput) stochTfInput.value = state.STOCH_TF;
        const stochRsiLenInput = document.getElementById('stoch-rsi-len');
        if (stochRsiLenInput) stochRsiLenInput.value = state.STOCH_RSI_LEN;
        const stochLenInput = document.getElementById('stoch-len');
        if (stochLenInput) stochLenInput.value = state.STOCH_LEN;
        const stochKInput = document.getElementById('stoch-k');
        if (stochKInput) stochKInput.value = state.STOCH_K;
        const stochDInput = document.getElementById('stoch-d');
        if (stochDInput) stochDInput.value = state.STOCH_D;
        const stochRepaintInput = document.getElementById('stoch-allow-repaint');
        if (stochRepaintInput) stochRepaintInput.checked = state.STOCH_ALLOW_REPAINT;

        const capInput = document.getElementById('capital-input');
        if (capInput) capInput.value = state.virtualCapital.toFixed(2);
        const levInput = document.getElementById('leverage-input');
        if (levInput) levInput.value = state.leverage;
        const tpslToggle = document.getElementById('toggle-tpsl');
        if (tpslToggle) tpslToggle.checked = state.tpslEnabled;
        const tpInput = document.getElementById('tp-input');
        if (tpInput) tpInput.value = state.tpRoi;
        const slInput = document.getElementById('sl-input');
        if (slInput) slInput.value = state.slRoi;

        if (signalSelect) signalSelect.value = state.signalType;
        if (toggleAutoTrade) toggleAutoTrade.checked = state.autoTradeEnabled;

        if (data.activePosition) {
            state.activePosition = data.activePosition;
            renderActivePosition();
        } else {
            state.activePosition = null;
            if (activePosInfo) activePosInfo.classList.add('hidden');
        }

        if (acc.symbol && acc.symbol !== state.currentSymbol) {
            state.currentSymbol = acc.symbol;
            if (symbolSelect) symbolSelect.value = state.currentSymbol;
            await loadChartData(state.currentSymbol);
        }
        updateBotStateBadge();
    } catch (e) { }
}

async function updateConfig() {
    if (!state.authToken) return;
    const wtTf = document.getElementById('wt-tf')?.value || state.WT_TF;
    const wtN1 = parseInt(document.getElementById('wt-n1')?.value || state.WT_CHANNEL_LEN, 10);
    const wtN2 = parseInt(document.getElementById('wt-n2')?.value || state.WT_AVG_LEN, 10);
    const wtSig = parseInt(document.getElementById('wt-sig')?.value || state.WT_SIG_LEN, 10);
    const wtOb = parseInt(document.getElementById('wt-ob')?.value || state.WT_OB_LEVEL, 10);
    const wtAllowRepaint = document.getElementById('wt-allow-repaint')?.checked || false;
    const wtIgnoreObos = document.getElementById('wt-ignore-obos')?.checked || false;

    const macdTf = document.getElementById('macd-tf')?.value || state.MACD_TF;
    const macdFast = parseInt(document.getElementById('macd-fast')?.value || state.MACD_FAST, 10);
    const macdSlow = parseInt(document.getElementById('macd-slow')?.value || state.MACD_SLOW, 10);
    const macdSig = parseInt(document.getElementById('macd-sig')?.value || state.MACD_SIG, 10);
    const macdAllowRepaint = document.getElementById('macd-allow-repaint')?.checked || false;

    const stochTf = document.getElementById('stoch-tf')?.value || state.STOCH_TF;
    const stochRsiLen = parseInt(document.getElementById('stoch-rsi-len')?.value || state.STOCH_RSI_LEN, 10);
    const stochLen = parseInt(document.getElementById('stoch-len')?.value || state.STOCH_LEN, 10);
    const stochK = parseInt(document.getElementById('stoch-k')?.value || state.STOCH_K, 10);
    const stochD = parseInt(document.getElementById('stoch-d')?.value || state.STOCH_D, 10);
    const stochAllowRepaint = document.getElementById('stoch-allow-repaint')?.checked || false;

    try {
        await saveAccountConfig({
            leverage: parseInt(document.getElementById('leverage-input').value) || 1,
            tpsl_enabled: document.getElementById('toggle-tpsl').checked,
            tp_roi: parseFloat(document.getElementById('tp-input').value) || 10,
            sl_roi: parseFloat(document.getElementById('sl-input').value) || -5,
            auto_trade_enabled: toggleAutoTrade ? toggleAutoTrade.checked : false,
            signal_type: signalSelect ? signalSelect.value : 'none',
            wt_tf: wtTf,
            wt_n1: wtN1,
            wt_n2: wtN2,
            wt_sig: wtSig,
            wt_ob: wtOb,
            wt_allow_repaint: wtAllowRepaint,
            wt_ignore_obos: wtIgnoreObos,
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
            symbol: state.currentSymbol
        });
        state.autoTradeEnabled = toggleAutoTrade ? toggleAutoTrade.checked : false;
        state.signalType = signalSelect ? signalSelect.value : 'none';
        updateBotStateBadge();
    } catch (e) { }
}

async function updateBackendStatus() {
    try {
        const data = await fetchBackendStatus();
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

function saveUIConfig() {
    const uiConfig = {
        showMA: document.getElementById('toggle-ma')?.checked,
        maPeriod: parseInt(document.getElementById('ma-length')?.value, 10),
        showBB: document.getElementById('toggle-bb')?.checked,
        showWT: document.getElementById('toggle-wt')?.checked,
        wtHeight: parseInt(document.getElementById('wt-chart-container')?.style.height || '150', 10),
        wtTF: document.getElementById('wt-tf')?.value || '5m',
        wtN1: parseInt(document.getElementById('wt-n1')?.value || '10', 10),
        wtN2: parseInt(document.getElementById('wt-n2')?.value || '21', 10),
        wtSig: parseInt(document.getElementById('wt-sig')?.value || '4', 10),
        wtOb: parseInt(document.getElementById('wt-ob')?.value || '53', 10),
        wtAllowRepaint: document.getElementById('wt-allow-repaint')?.checked || false,
        wtIgnoreObos: document.getElementById('wt-ignore-obos')?.checked || false,
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
            if (typeof config.showMA === 'boolean' && document.getElementById('toggle-ma')) document.getElementById('toggle-ma').checked = config.showMA;
            if (typeof config.showBB === 'boolean' && document.getElementById('toggle-bb')) document.getElementById('toggle-bb').checked = config.showBB;
            if (config.maPeriod && document.getElementById('ma-length')) {
                document.getElementById('ma-length').value = config.maPeriod;
                state.maPeriod = config.maPeriod;
            }
            if (typeof config.showWT === 'boolean' && document.getElementById('toggle-wt')) {
                document.getElementById('toggle-wt').checked = config.showWT;
            }
            if (config.wtHeight && document.getElementById('wt-chart-container')) {
                document.getElementById('wt-chart-container').style.height = `${config.wtHeight}px`;
            }
            if (config.wtTF && document.getElementById('wt-tf')) {
                document.getElementById('wt-tf').value = config.wtTF;
                state.WT_TF = config.wtTF;
            }
            if (config.wtN1 && document.getElementById('wt-n1')) {
                document.getElementById('wt-n1').value = config.wtN1;
                state.WT_CHANNEL_LEN = config.wtN1;
            }
            if (config.wtN2 && document.getElementById('wt-n2')) {
                document.getElementById('wt-n2').value = config.wtN2;
                state.WT_AVG_LEN = config.wtN2;
            }
            if (config.wtSig && document.getElementById('wt-sig')) {
                document.getElementById('wt-sig').value = config.wtSig;
                state.WT_SIG_LEN = config.wtSig;
            }
            if (config.wtOb && document.getElementById('wt-ob')) {
                document.getElementById('wt-ob').value = config.wtOb;
                state.WT_OB_LEVEL = config.wtOb;
            }
            if (typeof config.wtAllowRepaint === 'boolean' && document.getElementById('wt-allow-repaint')) {
                document.getElementById('wt-allow-repaint').checked = config.wtAllowRepaint;
                state.WT_ALLOW_REPAINT = config.wtAllowRepaint;
            }
            if (typeof config.wtIgnoreObos === 'boolean' && document.getElementById('wt-ignore-obos')) {
                document.getElementById('wt-ignore-obos').checked = config.wtIgnoreObos;
                state.WT_IGNORE_OBOS = config.wtIgnoreObos;
            }
            if (typeof config.showSupertrend === 'boolean' && document.getElementById('toggle-supertrend')) {
                document.getElementById('toggle-supertrend').checked = config.showSupertrend;
            }
            if (config.supertrendPeriod && document.getElementById('supertrend-period')) {
                document.getElementById('supertrend-period').value = config.supertrendPeriod;
                state.supertrendPeriod = config.supertrendPeriod;
            }
            if (config.supertrendMultiplier && document.getElementById('supertrend-multiplier')) {
                document.getElementById('supertrend-multiplier').value = config.supertrendMultiplier;
                state.supertrendMultiplier = config.supertrendMultiplier;
            }
            if (typeof config.showMACD === 'boolean' && document.getElementById('toggle-macd')) {
                document.getElementById('toggle-macd').checked = config.showMACD;
            }
            if (config.macdHeight && document.getElementById('macd-chart-container')) {
                document.getElementById('macd-chart-container').style.height = `${config.macdHeight}px`;
            }
            if (config.macdTF && document.getElementById('macd-tf')) {
                document.getElementById('macd-tf').value = config.macdTF;
                state.MACD_TF = config.macdTF;
            }
            if (config.macdFast && document.getElementById('macd-fast')) {
                document.getElementById('macd-fast').value = config.macdFast;
                state.MACD_FAST = config.macdFast;
            }
            if (config.macdSlow && document.getElementById('macd-slow')) {
                document.getElementById('macd-slow').value = config.macdSlow;
                state.MACD_SLOW = config.macdSlow;
            }
            if (config.macdSig && document.getElementById('macd-sig')) {
                document.getElementById('macd-sig').value = config.macdSig;
                state.MACD_SIG = config.macdSig;
            }
            if (typeof config.showStochRSI === 'boolean' && document.getElementById('toggle-stoch-rsi')) {
                document.getElementById('toggle-stoch-rsi').checked = config.showStochRSI;
            }
            if (config.stochHeight && document.getElementById('stoch-chart-container')) {
                document.getElementById('stoch-chart-container').style.height = `${config.stochHeight}px`;
            }
            if (config.stochTF && document.getElementById('stoch-tf')) {
                document.getElementById('stoch-tf').value = config.stochTF;
                state.STOCH_TF = config.stochTF;
            }
            if (config.stochRsiLen && document.getElementById('stoch-rsi-len')) {
                document.getElementById('stoch-rsi-len').value = config.stochRsiLen;
                state.STOCH_RSI_LEN = config.stochRsiLen;
            }
            if (config.stochLen && document.getElementById('stoch-len')) {
                document.getElementById('stoch-len').value = config.stochLen;
                state.STOCH_LEN = config.stochLen;
            }
            if (config.stochK && document.getElementById('stoch-k')) {
                document.getElementById('stoch-k').value = config.stochK;
                state.STOCH_K = config.stochK;
            }
            if (config.stochD && document.getElementById('stoch-d')) {
                document.getElementById('stoch-d').value = config.stochD;
                state.STOCH_D = config.stochD;
            }
        }
    } catch (e) { }
}

async function init() {
    loadUIConfig();
    updateAuthUI();
    
    initCharts(
        chartContainer, 
        document.getElementById('wt-chart-container'), 
        document.getElementById('macd-chart-container'), 
        document.getElementById('stoch-chart-container')
    );

    await loadSymbols();
    await loadChartData(state.currentSymbol);

    if (state.authToken) {
        await loadAccountState();
    }

    setInterval(updateBackendStatus, 10000);
    updateBackendStatus();

    // Event Listeners setup
    btnOpenLogin?.addEventListener('click', () => authModal?.classList.remove('hidden'));
    btnCloseAuth?.addEventListener('click', () => authModal?.classList.add('hidden'));
    btnLogout?.addEventListener('click', handleLogout);

    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', () => {
            headerControls?.classList.toggle('show');
            authControls?.classList.toggle('show');
        });
    }

    if (mobileTradeBtn) {
        mobileTradeBtn.addEventListener('click', () => {
            tradePanel?.classList.toggle('show');
            if (tradePanel?.classList.contains('show')) {
                mobileTradeBtn.innerHTML = '❌ Close';
                mobileTradeBtn.style.backgroundColor = 'var(--panel-bg)';
            } else {
                mobileTradeBtn.innerHTML = '💬 Trade';
                mobileTradeBtn.style.backgroundColor = 'var(--accent-color)';
            }
        });
    }

    btnRecharge?.addEventListener('click', async () => {
        if (!state.authToken) return;
        const newCap = parseFloat(document.getElementById('capital-input').value);
        if (isNaN(newCap) || newCap < 0) return alert('Invalid capital amount');

        try {
            const res = await rechargeCapital(newCap);
            document.getElementById('capital-input').value = res.virtual_capital.toFixed(2);
            state.virtualCapital = res.virtual_capital;
            alert(`Capital has been set to ${res.virtual_capital} USDT`);
        } catch (e) { }
    });

    authToggleLink?.addEventListener('click', (e) => {
        e.preventDefault();
        state.isLoginMode = !state.isLoginMode;
        authTitle.textContent = state.isLoginMode ? "Login to CATS" : "Register for CATS";
        btnAuthSubmit.textContent = state.isLoginMode ? "Login" : "Register";
        document.getElementById('auth-toggle-text').innerHTML = state.isLoginMode
            ? `Don't have an account? <a href="#" id="auth-toggle-link" style="color:var(--up-color); text-decoration:none;">Register here</a>`
            : `Already have an account? <a href="#" id="auth-toggle-link" style="color:var(--up-color); text-decoration:none;">Login here</a>`;

        document.getElementById('auth-toggle-link').addEventListener('click', (ev) => {
            ev.preventDefault();
            authToggleLink.click();
        });
    });

    btnAuthSubmit?.addEventListener('click', async () => {
        const username = authUsername.value;
        const password = authPassword.value;
        if (!username || !password) return alert('Enter credentials');

        const endpoint = state.isLoginMode ? '/auth/login' : '/auth/register';
        try {
            const res = await apiCall(endpoint, 'POST', { username, password });
            if (state.isLoginMode) {
                state.authToken = res.token;
                state.currentUsername = res.username;
                localStorage.setItem('cats_token', state.authToken);
                localStorage.setItem('cats_username', state.currentUsername);
                authModal?.classList.add('hidden');
                updateAuthUI();
                await loadAccountState();
                state.ws?.close();
                connectWebSocket(state.currentSymbol, loadAccountState);
                alert('Successfully logged in!');
            } else {
                alert('Registration successful! You can now login.');
                authToggleLink.click();
            }
        } catch (e) { }
    });

    document.getElementById('leverage-input')?.addEventListener('change', updateConfig);
    document.getElementById('toggle-tpsl')?.addEventListener('change', updateConfig);
    document.getElementById('tp-input')?.addEventListener('change', updateConfig);
    document.getElementById('sl-input')?.addEventListener('change', updateConfig);
    if (toggleAutoTrade) toggleAutoTrade.addEventListener('change', updateConfig);
    if (signalSelect) signalSelect.addEventListener('change', updateConfig);

    document.getElementById('toggle-ma')?.addEventListener('change', (e) => {
        if (state.maSeries) state.maSeries.applyOptions({ visible: e.target.checked });
        saveUIConfig();
    });
    document.getElementById('ma-length')?.addEventListener('change', (e) => {
        let val = parseInt(e.target.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        e.target.value = val;
        state.maPeriod = val;
        if (state.klineData) updateChartSeries();
        saveUIConfig();
    });
    document.getElementById('toggle-bb')?.addEventListener('change', (e) => {
        const isVisible = e.target.checked;
        if (state.bbUpperSeries) state.bbUpperSeries.applyOptions({ visible: isVisible });
        if (state.bbLowerSeries) state.bbLowerSeries.applyOptions({ visible: isVisible });
        if (state.bbMiddleSeries) state.bbMiddleSeries.applyOptions({ visible: isVisible });
        saveUIConfig();
    });

    const toggleWT = document.getElementById('toggle-wt');
    const wtContainer = document.getElementById('wt-chart-container');
    const resizer = document.getElementById('chart-resizer');
    const wtParamsContainer = document.getElementById('wt-params-container');

    const updateWTVisibility = () => {
        const isVisible = toggleWT ? toggleWT.checked : false;
        if (isVisible) {
            wtContainer?.classList.remove('hidden');
            resizer?.classList.remove('hidden');
            wtParamsContainer?.classList.remove('hidden');
        } else {
            wtContainer?.classList.add('hidden');
            resizer?.classList.add('hidden');
            wtParamsContainer?.classList.add('hidden');
        }
        saveUIConfig();
        applyIndicatorMarkers();
    };
    toggleWT?.addEventListener('change', updateWTVisibility);

    const toggleMACD = document.getElementById('toggle-macd');
    const macdContainer = document.getElementById('macd-chart-container');
    const resizerMacd = document.getElementById('chart-resizer-macd');
    const macdParamsContainer = document.getElementById('macd-params-container');

    const updateMACDVisibility = () => {
        const isVisible = toggleMACD ? toggleMACD.checked : false;
        if (isVisible) {
            macdContainer?.classList.remove('hidden');
            resizerMacd?.classList.remove('hidden');
            macdParamsContainer?.classList.remove('hidden');
        } else {
            macdContainer?.classList.add('hidden');
            resizerMacd?.classList.add('hidden');
            macdParamsContainer?.classList.add('hidden');
        }
        saveUIConfig();
        applyIndicatorMarkers();
    };
    toggleMACD?.addEventListener('change', updateMACDVisibility);

    const bindWTParamInput = (id, minVal) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < minVal) val = minVal;
            e.target.value = val;

            if (id === 'wt-n1') state.WT_CHANNEL_LEN = val;
            else if (id === 'wt-n2') state.WT_AVG_LEN = val;
            else if (id === 'wt-sig') state.WT_SIG_LEN = val;
            else if (id === 'wt-ob') state.WT_OB_LEVEL = val;

            updateWTPriceLines();
            if (state.klineData) updateChartSeries();
            saveUIConfig();

            if (state.authToken) {
                await updateConfig();
            }
        });
    };

    bindWTParamInput('wt-n1', 1);
    bindWTParamInput('wt-n2', 1);
    bindWTParamInput('wt-sig', 1);
    bindWTParamInput('wt-ob', 1);

    document.getElementById('wt-allow-repaint')?.addEventListener('change', async (e) => {
        state.WT_ALLOW_REPAINT = e.target.checked;
        if (state.klineData) updateChartSeries();
        saveUIConfig();
        if (state.authToken) await updateConfig();
    });

    document.getElementById('wt-ignore-obos')?.addEventListener('change', async (e) => {
        state.WT_IGNORE_OBOS = e.target.checked;
        if (state.klineData) updateChartSeries();
        saveUIConfig();
        if (state.authToken) await updateConfig();
    });

    document.getElementById('wt-tf')?.addEventListener('change', async (e) => {
        state.WT_TF = e.target.value;
        if (state.klineData) updateChartSeries();
        saveUIConfig();
        if (state.authToken) await updateConfig();
    });

    const bindMACDParamInput = (id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < 1) val = 1;
            e.target.value = val;

            if (id === 'macd-fast') state.MACD_FAST = val;
            else if (id === 'macd-slow') state.MACD_SLOW = val;
            else if (id === 'macd-sig') state.MACD_SIG = val;

            if (state.klineData) updateChartSeries();
            saveUIConfig();
            if (state.authToken) await updateConfig();
        });
    };

    bindMACDParamInput('macd-fast');
    bindMACDParamInput('macd-slow');
    bindMACDParamInput('macd-sig');

    document.getElementById('macd-allow-repaint')?.addEventListener('change', async (e) => {
        state.MACD_ALLOW_REPAINT = e.target.checked;
        if (state.authToken) await updateConfig();
    });

    document.getElementById('macd-tf')?.addEventListener('change', async (e) => {
        state.MACD_TF = e.target.value;
        if (state.klineData) updateChartSeries();
        saveUIConfig();
        if (state.authToken) await updateConfig();
    });

    // Supertrend bindings
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
        if (state.klineData) {
            renderSupertrend();
        }
        saveUIConfig();
    };

    toggleSupertrend?.addEventListener('change', updateSupertrendVisibility);

    const onSupertrendParamChange = () => {
        const stPeriodEl = document.getElementById('supertrend-period');
        const stMultEl = document.getElementById('supertrend-multiplier');
        if (!stPeriodEl || !stMultEl) return;
        let pVal = parseInt(stPeriodEl.value, 10);
        let mVal = parseFloat(stMultEl.value);
        if (isNaN(pVal) || pVal < 1) pVal = 10;
        if (isNaN(mVal) || mVal <= 0) mVal = 3.0;

        stPeriodEl.value = pVal;
        stMultEl.value = mVal;

        state.supertrendPeriod = pVal;
        state.supertrendMultiplier = mVal;

        if (state.klineData) updateChartSeries();
        saveUIConfig();
    };

    document.getElementById('supertrend-period')?.addEventListener('change', onSupertrendParamChange);
    document.getElementById('supertrend-multiplier')?.addEventListener('change', onSupertrendParamChange);

    // Stochastic RSI bindings
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

    toggleStoch?.addEventListener('change', updateStochVisibility);

    const bindStochParamInput = (id) => {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', async (e) => {
            let val = parseInt(e.target.value, 10);
            if (isNaN(val) || val < 1) val = 1;
            e.target.value = val;

            if (id === 'stoch-rsi-len') state.STOCH_RSI_LEN = val;
            else if (id === 'stoch-len') state.STOCH_LEN = val;
            else if (id === 'stoch-k') state.STOCH_K = val;
            else if (id === 'stoch-d') state.STOCH_D = val;

            updateStochPriceLines();
            if (state.klineData) updateChartSeries();
            saveUIConfig();

            if (state.authToken) {
                await updateConfig();
            }
        });
    };

    bindStochParamInput('stoch-rsi-len');
    bindStochParamInput('stoch-len');
    bindStochParamInput('stoch-k');
    bindStochParamInput('stoch-d');

    document.getElementById('stoch-allow-repaint')?.addEventListener('change', async (e) => {
        state.STOCH_ALLOW_REPAINT = e.target.checked;
        if (state.klineData) updateChartSeries();
        saveUIConfig();
        if (state.authToken) await updateConfig();
    });

    document.getElementById('stoch-tf')?.addEventListener('change', async (e) => {
        state.STOCH_TF = e.target.value;
        if (state.klineData) updateChartSeries();
        saveUIConfig();
        if (state.authToken) await updateConfig();
    });

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

    resizer?.addEventListener('mousedown', (e) => {
        startResize(e.clientY, resizer, wtContainer);
        e.preventDefault();
    });

    resizer?.addEventListener('touchstart', (e) => {
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

    document.addEventListener('mousemove', (e) => doResize(e.clientY));
    document.addEventListener('touchmove', (e) => {
        if (isResizing && e.touches.length > 0) {
            doResize(e.touches[0].clientY);
            e.preventDefault();
        }
    }, { passive: false });

    document.addEventListener('mouseup', stopResize);
    document.addEventListener('touchend', stopResize);

    // Trading execution button listeners
    btnLong?.addEventListener('click', async () => {
        if (state.activePosition) return alert("A position is already open.");
        try {
            await openTrade('LONG', state.currentSymbol, state.lastClose);
            await loadAccountState();
        } catch (e) { }
    });

    btnShort?.addEventListener('click', async () => {
        if (state.activePosition) return alert("A position is already open.");
        try {
            await openTrade('SHORT', state.currentSymbol, state.lastClose);
            await loadAccountState();
        } catch (e) { }
    });

    btnClose?.addEventListener('click', async () => {
        if (!state.activePosition) return;
        try {
            const res = await closeTrade(state.lastClose);
            state.activePosition = null;
            document.getElementById('capital-input').value = res.newCapital.toFixed(2);
            activePosInfo?.classList.add('hidden');
            if (btnLong) btnLong.disabled = false;
            if (btnShort) btnShort.disabled = false;
        } catch (e) { }
    });

    btnHistory?.addEventListener('click', async () => {
        state.tradeHistory = await fetchTradeHistory();
        renderHistoryTable();
        historyModal?.classList.remove('hidden');
    });

    btnCloseHistory?.addEventListener('click', () => historyModal?.classList.add('hidden'));
    btnExportCsv?.addEventListener('click', exportHistoryCsv);

    btnClearHistory?.addEventListener('click', () => {
        if (!state.tradeHistory || state.tradeHistory.length === 0) return alert("기록된 거래 내역이 없습니다.");
        confirmModal?.classList.remove('hidden');
    });

    btnConfirmCancel?.addEventListener('click', () => confirmModal?.classList.add('hidden'));

    btnConfirmOk?.addEventListener('click', async () => {
        confirmModal?.classList.add('hidden');
        if (state.authToken) {
            await clearTradeHistory();
        }
        state.tradeHistory = [];
        renderHistoryTable();
    });

    symbolSelect?.addEventListener('change', async (e) => {
        state.currentSymbol = e.target.value;
        await loadChartData(state.currentSymbol);
        if (state.authToken) {
            await updateConfig();
        }
    });

    // ResizeObservers
    const resizeObserver = new ResizeObserver(entries => {
        if (!state.chart) return;
        const { width, height } = entries[0].contentRect;
        state.chart.applyOptions({ width, height });
    });
    if (chartContainer) resizeObserver.observe(chartContainer);

    const wtResizeObserver = new ResizeObserver(entries => {
        if (!state.wtChart) return;
        const { width, height } = entries[0].contentRect;
        state.wtChart.applyOptions({ width, height });
    });
    if (wtContainer) wtResizeObserver.observe(wtContainer);

    const macdResizeObserver = new ResizeObserver(entries => {
        if (!state.macdChart) return;
        const { width, height } = entries[0].contentRect;
        state.macdChart.applyOptions({ width, height });
    });
    const macdContainerEl = document.getElementById('macd-chart-container');
    if (macdContainerEl) macdResizeObserver.observe(macdContainerEl);

    const stochResizeObserver = new ResizeObserver(entries => {
        if (!state.stochRsiChart) return;
        const { width, height } = entries[0].contentRect;
        state.stochRsiChart.applyOptions({ width, height });
    });
    const stochContainerEl = document.getElementById('stoch-chart-container');
    if (stochContainerEl) stochResizeObserver.observe(stochContainerEl);

    updateWTVisibility();
    updateMACDVisibility();
    updateStochVisibility();
    updateSupertrendVisibility();
}

document.addEventListener('DOMContentLoaded', init);
