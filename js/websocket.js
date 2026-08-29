import { state } from './state.js';
import { updatePriceDisplay, updateVisualPnL, renderActivePosition } from './tradeUI.js';
import { updateIndicatorsLive } from './chartManager.js';

let reconnectTimeout = null;

export function connectWebSocket(symbol, onAccountRefresh) {
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    const basePath = window.location.pathname.replace(/\/$/, '');
    const wsProto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${wsProto}${window.location.host}${window.location.pathname}`;
    const qs = state.authToken ? `?token=${state.authToken}` : '';

    state.ws = new WebSocket(`${wsUrl}${qs}`);

    state.ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        // Binance Stream Forwarded
        if (message.e === 'kline' && message.s === symbol) {
            const kline = message.k;
            const tick = {
                time: Math.floor(kline.t / 1000),
                open: parseFloat(kline.o),
                high: parseFloat(kline.h),
                low: parseFloat(kline.l),
                close: parseFloat(kline.c)
            };
            if (state.candleSeries) {
                state.candleSeries.update(tick);
            }

            const lastExistingTick = state.klineData[state.klineData.length - 1];
            if (lastExistingTick && lastExistingTick.time === tick.time) {
                state.klineData[state.klineData.length - 1] = tick;
            } else {
                state.klineData.push(tick);
            }

            updateIndicatorsLive();
            updatePriceDisplay(tick.close, state.lastClose);

            if (state.activePosition && state.authToken) {
                updateVisualPnL(tick.close);
            }

            state.lastClose = tick.close;
        }

        // Heartbeat
        if (message.type === 'hb') {
            state.lastHB = Date.now();
            return;
        }

        // Position Opened event
        if (message.type === 'position_opened') {
            state.activePosition = message.data;
            renderActivePosition();
            if (onAccountRefresh) onAccountRefresh();
        }

        // Position Closed event
        if (message.type === 'position_closed') {
            console.log(`[Position Closed] PnL: ${message.data.pnl.toFixed(2)} USDT (${message.data.roe.toFixed(2)}%)`);
            state.activePosition = null;
            document.getElementById('active-position-info')?.classList.add('hidden');
            if (onAccountRefresh) onAccountRefresh();
        }
    };

    state.ws.onclose = () => {
        console.log('WebSocket disconnected. Reconnecting in 3 seconds...');
        reconnectTimeout = setTimeout(() => connectWebSocket(symbol, onAccountRefresh), 3000);
    };

    state.ws.onerror = (error) => {
        console.error('WebSocket Error:', error);
        state.ws.close();
    };
}
