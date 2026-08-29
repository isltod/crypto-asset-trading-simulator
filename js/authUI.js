import { state } from './state.js';
import { apiCall } from './api.js';

export function updateAuthUI() {
    const btnOpenLogin = document.getElementById('btn-open-login');
    const btnLogout = document.getElementById('btn-logout');
    const userDisplay = document.getElementById('user-display');
    const btnLong = document.getElementById('btn-long');
    const btnShort = document.getElementById('btn-short');
    const btnRecharge = document.getElementById('btn-recharge');
    const signalSelect = document.getElementById('signal-select');
    const toggleAutoTrade = document.getElementById('toggle-autotrade');
    const activePosInfo = document.getElementById('active-position-info');
    const leverageInput = document.getElementById('leverage-input');
    const capitalInput = document.getElementById('capital-input');

    if (state.authToken) {
        if (btnOpenLogin) btnOpenLogin.style.display = 'none';
        if (btnLogout) btnLogout.style.display = 'block';
        if (userDisplay) {
            userDisplay.style.display = 'block';
            userDisplay.textContent = `Hello, ${state.currentUsername}`;
        }

        if (btnLong) btnLong.disabled = false;
        if (btnShort) btnShort.disabled = false;
        if (btnRecharge) btnRecharge.disabled = false;
        if (leverageInput) leverageInput.disabled = false;
        if (capitalInput) capitalInput.disabled = false;
        if (signalSelect) signalSelect.disabled = false;
        if (toggleAutoTrade) toggleAutoTrade.disabled = false;
    } else {
        if (btnOpenLogin) btnOpenLogin.style.display = 'block';
        if (btnLogout) btnLogout.style.display = 'none';
        if (userDisplay) userDisplay.style.display = 'none';

        if (btnLong) btnLong.disabled = true;
        if (btnShort) btnShort.disabled = true;
        if (btnRecharge) btnRecharge.disabled = true;
        if (leverageInput) leverageInput.disabled = true;
        if (capitalInput) {
            capitalInput.disabled = true;
            capitalInput.value = '-';
        }
        if (signalSelect) signalSelect.disabled = true;
        if (toggleAutoTrade) toggleAutoTrade.disabled = true;

        if (activePosInfo) activePosInfo.classList.add('hidden');
    }
}

export function updateBotStateBadge() {
    const botStateBadge = document.getElementById('bot-state-badge');
    if (!botStateBadge) return;

    if (!state.autoTradeEnabled || state.signalType === 'none') {
        botStateBadge.className = 'badge badge-inactive';
        botStateBadge.textContent = 'Off';
        return;
    }

    if (state.activePosition) {
        if (state.activePosition.side === 'LONG') {
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
