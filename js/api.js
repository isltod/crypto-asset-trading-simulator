import { state } from './state.js';

const basePath = window.location.pathname.replace(/\/$/, '');
export const API_URL = basePath + '/api';
export const WS_URL = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + window.location.pathname;
export const BINANCE_REST_URL = API_URL + '/proxy';

export function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': state.authToken ? `Bearer ${state.authToken}` : ''
    };
}

let logoutHandler = null;
export function setLogoutHandler(fn) {
    logoutHandler = fn;
}

export async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const options = { method, headers: getHeaders() };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(`${API_URL}${endpoint}`, options);
        const data = await res.json();

        if (res.status === 401 || res.status === 403) {
            if (logoutHandler) logoutHandler();
            throw new Error("Unauthorized. Please login again.");
        }
        if (!res.ok) throw new Error(data.error || "API Error");
        return data;
    } catch (e) {
        alert(e.message);
        throw e;
    }
}

export async function fetchAccountData() {
    if (!state.authToken) return null;
    return await apiCall('/account');
}

export async function saveAccountConfig(config) {
    if (!state.authToken) return;
    return await apiCall('/account/config', 'POST', config);
}

export async function rechargeCapital(amount) {
    if (!state.authToken) return;
    return await apiCall('/account/recharge', 'POST', { virtual_capital: amount });
}

export async function fetchTradeHistory() {
    if (!state.authToken) return [];
    return await apiCall('/history');
}

export async function clearTradeHistory() {
    if (!state.authToken) return;
    return await apiCall('/history', 'DELETE');
}

export async function openTrade(side, symbol, currentPrice) {
    return await apiCall('/trade/open', 'POST', { side, symbol, currentPrice });
}

export async function closeTrade(currentPrice) {
    return await apiCall('/trade/close', 'POST', { currentPrice });
}

export async function fetchBackendStatus() {
    const res = await fetch(API_URL + '/status');
    return await res.json();
}

export async function fetchSymbols() {
    const response = await fetch(`${BINANCE_REST_URL}/exchangeInfo`);
    return await response.json();
}

export async function fetchKlines(symbol, interval = '1m') {
    const res = await fetch(`${BINANCE_REST_URL}/klines?symbol=${symbol}&interval=${interval}`);
    return await res.json();
}

export async function fetchMTFKlines(symbol, timeframe = '15m') {
    try {
        const res = await fetch(`${BINANCE_REST_URL}/mtf-cache?symbol=${symbol}&timeframe=${timeframe}`);
        return await res.json();
    } catch (e) {
        return [];
    }
}
