import { state } from './state.js';
import { openTrade, closeTrade, rechargeCapital, fetchTradeHistory, clearTradeHistory } from './api.js';

export function updatePriceDisplay(current, previous) {
    const currentPriceEl = document.getElementById('current-price');
    if (!currentPriceEl) return;
    let formatStr = current.toFixed(current < 1 ? 5 : 2);
    if (current > previous) currentPriceEl.className = 'price up';
    else if (current < previous) currentPriceEl.className = 'price down';
    currentPriceEl.textContent = formatStr;
}

export function formatEntryTime(timeStr) {
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

export function renderActivePosition() {
    const btnLong = document.getElementById('btn-long');
    const btnShort = document.getElementById('btn-short');
    const activePosInfo = document.getElementById('active-position-info');
    const posSymbolEl = document.getElementById('pos-symbol');
    const posSideEl = document.getElementById('pos-side');
    const posEntryTypeEl = document.getElementById('pos-entry-type');
    const posEntryTimeEl = document.getElementById('pos-entry-time');
    const posEntryEl = document.getElementById('pos-entry');
    const posMarginEl = document.getElementById('pos-margin');
    const posSizeEl = document.getElementById('pos-size');

    if (!activePosInfo) return;

    if (!state.activePosition) {
        activePosInfo.classList.add('hidden');
        if (btnLong) btnLong.disabled = false;
        if (btnShort) btnShort.disabled = false;
        return;
    }

    if (btnLong) btnLong.disabled = true;
    if (btnShort) btnShort.disabled = true;
    activePosInfo.classList.remove('hidden');

    if (posSymbolEl) posSymbolEl.textContent = state.activePosition.symbol || '';
    if (posEntryTimeEl) posEntryTimeEl.textContent = formatEntryTime(state.activePosition.entry_time || state.activePosition.entryTime);
    if (posSideEl) {
        posSideEl.textContent = state.activePosition.side;
        posSideEl.style.color = state.activePosition.side === 'LONG' ? 'var(--up-color)' : 'var(--down-color)';
    }
    if (posEntryTypeEl) {
        const type = state.activePosition.entry_type || state.activePosition.entryType || 'MANUAL';
        posEntryTypeEl.textContent = type === 'AUTO' ? 'Auto (🤖)' : 'Manual (👤)';
        posEntryTypeEl.style.color = type === 'AUTO' ? 'var(--accent-color)' : 'var(--text-secondary)';
    }

    const entryPrice = state.activePosition.entry_price !== undefined ? state.activePosition.entry_price : state.activePosition.entryPrice;
    if (posEntryEl) posEntryEl.textContent = entryPrice ? entryPrice.toFixed(2) : '-';
    if (posMarginEl) posMarginEl.textContent = state.activePosition.margin ? state.activePosition.margin.toFixed(2) + " USDT" : '-';
    if (posSizeEl) posSizeEl.textContent = state.activePosition.size ? state.activePosition.size.toFixed(4) : '-';

    updateVisualPnL(state.lastClose);
}

export function updateVisualPnL(currentPrice) {
    if (!state.activePosition || !currentPrice) return;
    const posPnlEl = document.getElementById('pos-pnl');
    const posRoeEl = document.getElementById('pos-roe');
    if (!posPnlEl || !posRoeEl) return;

    let pnl = 0, priceMovePct = 0;
    const entryPrice = state.activePosition.entry_price !== undefined ? state.activePosition.entry_price : state.activePosition.entryPrice;
    if (state.activePosition.side === 'LONG') {
        pnl = (currentPrice - entryPrice) * state.activePosition.size;
        priceMovePct = ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
        pnl = (entryPrice - currentPrice) * state.activePosition.size;
        priceMovePct = ((entryPrice - currentPrice) / entryPrice) * 100;
    }
    const roe = priceMovePct * state.activePosition.leverage;

    posPnlEl.textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`;
    posPnlEl.className = `pnl-val ${pnl >= 0 ? 'up' : 'down'}`;
    posRoeEl.textContent = `${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%`;
    posRoeEl.className = `pnl-val ${roe >= 0 ? 'up' : 'down'}`;
}

export function renderHistoryTable() {
    const historyTbody = document.getElementById('history-tbody');
    if (!historyTbody) return;

    historyTbody.innerHTML = '';
    if (state.tradeHistory.length === 0) {
        historyTbody.innerHTML = '<tr><td colspan="11" style="text-align: center;">No completed trades yet.</td></tr>';
        return;
    }

    state.tradeHistory.forEach(row => {
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

export function exportHistoryCsv() {
    if (!state.tradeHistory || state.tradeHistory.length === 0) {
        alert("내보낼 거래 기록이 없습니다.");
        return;
    }

    const headers = ["Side", "Leverage", "Entry Time", "Exit Time", "Entry Price", "Exit Price", "PnL", "ROE(%)", "Fee", "Capital Before", "Capital After"];
    const rows = state.tradeHistory.map(row => [
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
}
