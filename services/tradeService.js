const { db } = require('../config/db');
const { latestPrices } = require('./marketService');

const closingUsers = new Set();
const openingUsers = new Set();

let notifyUserFn = null;

function setNotifyUserFunction(fn) {
    notifyUserFn = fn;
}

function openPositionInternal(userId, symbol, side, currentPrice, cb = null) {
    if (openingUsers.has(userId)) {
        if (cb) cb(false);
        return;
    }
    openingUsers.add(userId);

    const entryPrice = latestPrices[symbol] || currentPrice;
    if (!entryPrice) {
        openingUsers.delete(userId);
        if (cb) cb(false);
        return;
    }

    db.serialize(() => {
        db.get(`SELECT * FROM positions WHERE user_id = ?`, [userId], (err, pos) => {
            if (pos || err) {
                openingUsers.delete(userId);
                if (cb) cb(false);
                return;
            }

            db.get(`SELECT * FROM accounts WHERE user_id = ?`, [userId], (err, account) => {
                if (!account || err) {
                    openingUsers.delete(userId);
                    if (cb) cb(false);
                    return;
                }
                
                const margin = account.virtual_capital;
                if (margin <= 0) {
                    openingUsers.delete(userId);
                    console.log(`[AutoTrade] User ${userId} has insufficient capital: ${margin}`);
                    if (cb) cb(false);
                    return;
                }

                const size = (margin * account.leverage) / entryPrice;
                const feeRate = 0.0005;
                const entryFee = margin * account.leverage * feeRate;

                const newCapital = margin - entryFee;

                db.run(`UPDATE accounts SET virtual_capital = ? WHERE user_id = ?`, [newCapital, userId], (err) => {
                    if (err) {
                        openingUsers.delete(userId);
                        if (cb) cb(false);
                        return;
                    }
                    db.run(`INSERT INTO positions (user_id, symbol, side, entry_price, size, margin, leverage, entry_fee, capital_before, entry_type) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUTO')`, 
                            [userId, symbol, side, entryPrice, size, margin, account.leverage, entryFee, margin], function(err) {
                        openingUsers.delete(userId);
                        if (err) {
                            if (cb) cb(false);
                            return;
                        }
                        
                        console.log(`[AutoTrade] Position opened successfully for user ${userId}. Symbol: ${symbol}, Side: ${side}, Price: ${entryPrice}`);
                        
                        if (notifyUserFn) {
                            notifyUserFn(userId, { type: 'position_opened', data: { symbol, side, entry_price: entryPrice, size, margin, leverage: account.leverage, newCapital, entry_time: new Date().toISOString(), entry_type: 'AUTO' } });
                        }
                        if (cb) cb(true);
                    });
                });
            });
        });
    });
}

function closePosition(userId, specificPrice, res = null, cb = null) {
    if (closingUsers.has(userId)) {
        if (res) res.status(400).json({ error: "Close position already in progress" });
        if (cb) cb(false);
        return;
    }
    closingUsers.add(userId);

    db.get(`SELECT p.*, a.virtual_capital FROM positions p JOIN accounts a ON p.user_id = a.user_id WHERE p.user_id = ?`, [userId], (err, pos) => {
        if (err || !pos) {
            closingUsers.delete(userId);
            if (res) res.status(400).json({ error: "No open position" });
            if (cb) cb(false);
            return;
        }

        const closePrice = latestPrices[pos.symbol] || specificPrice;
        if (!closePrice) {
            closingUsers.delete(userId);
            if (res) res.status(400).json({ error: "Price not available" });
            if (cb) cb(false);
            return;
        }

        let pnl = 0;
        let priceMovePct = 0;

        if (pos.side === 'LONG') {
            pnl = (closePrice - pos.entry_price) * pos.size;
            priceMovePct = ((closePrice - pos.entry_price) / pos.entry_price) * 100;
        } else {
            pnl = (pos.entry_price - closePrice) * pos.size;
            priceMovePct = ((pos.entry_price - closePrice) / pos.entry_price) * 100;
        }

        const roe = priceMovePct * pos.leverage;
        const feeRate = 0.0005;
        const closingValue = closePrice * pos.size;
        const closeFee = closingValue * feeRate;
        const totalFee = pos.entry_fee + closeFee;

        let newVirtualCapital = pos.virtual_capital + pnl - closeFee;
        if (newVirtualCapital < 0) newVirtualCapital = 0;

        db.serialize(() => {
            db.run(`UPDATE accounts SET virtual_capital = ? WHERE user_id = ?`, [newVirtualCapital, userId]);
            db.run(`INSERT INTO trade_history (user_id, symbol, side, entry_time, entry_price, exit_price, pnl, roe, fee, capital_before, capital_after, leverage, entry_type)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, pos.symbol, pos.side, pos.entry_time, pos.entry_price, closePrice, pnl, roe, totalFee, pos.capital_before, newVirtualCapital, pos.leverage, pos.entry_type || 'MANUAL']);
            db.run(`DELETE FROM positions WHERE user_id = ?`, [userId], () => {
                closingUsers.delete(userId);
                const result = { pnl, roe, totalFee, newCapital: newVirtualCapital, closePrice };
                
                if (notifyUserFn) {
                    notifyUserFn(userId, { type: 'position_closed', data: result });
                }
                
                if (res) {
                    res.json({ message: "Position closed", ...result });
                }
                if (cb) cb(true);
            });
        });
    });
}

function checkTPSL(symbol, currentPrice) {
    db.all(`SELECT p.id, p.user_id, p.side, p.entry_price, p.leverage, p.entry_time, p.entry_type, 
                   p.max_price_move_pct, p.be_activated, a.tpsl_enabled, a.tp_roi, a.sl_roi, a.signal_type 
            FROM positions p 
            JOIN accounts a ON p.user_id = a.user_id 
            WHERE p.symbol = ?`, [symbol], (err, positions) => {
        if (err || !positions) return;

        positions.forEach(pos => {
            let priceMovePct = 0;
            if (pos.side === 'LONG') {
                priceMovePct = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
            } else {
                priceMovePct = ((pos.entry_price - currentPrice) / pos.entry_price) * 100;
            }
            const roe = priceMovePct * pos.leverage;

            // 0. Update real-time max MFE (Maximum Favorable Excursion)
            const currentMax = pos.max_price_move_pct || 0;
            if (priceMovePct > currentMax) {
                pos.max_price_move_pct = priceMovePct;
                db.run(`UPDATE positions SET max_price_move_pct = ? WHERE id = ?`, [priceMovePct, pos.id]);
            }

            // Liquidation check
            if (roe <= -100) {
                console.log(`[LIQN] Triggered for user ${pos.user_id}`);
                closePosition(pos.user_id, currentPrice);
                return;
            }

            // Step 1: User-configured hard TP / SL check
            if (pos.tpsl_enabled) {
                if (roe >= pos.tp_roi || roe <= pos.sl_roi) {
                    console.log(`[TPSL] Triggered for user ${pos.user_id} - ROE: ${roe.toFixed(2)}% (TP: ${pos.tp_roi}%, SL: ${pos.sl_roi}%)`);
                    closePosition(pos.user_id, currentPrice);
                    return;
                }
            }

            // Step 2 & 3: Extreme Breakout dynamic exits
            if (pos.signal_type === 'extreme_breakout' && pos.entry_type === 'AUTO') {
                const entryTimeMs = new Date(pos.entry_time).getTime();
                const nowMs = Date.now();
                const elapsedMs = !isNaN(entryTimeMs) ? nowMs - entryTimeMs : 0;
                const elapsedHours = elapsedMs / (3600 * 1000);

                // Step 3: 36h Timeout Exit
                if (elapsedHours >= 36) {
                    console.log(`[ExtremeBreakout] 36h Timeout Exit triggered for user ${pos.user_id}. Elapsed: ${elapsedHours.toFixed(1)}h`);
                    closePosition(pos.user_id, currentPrice);
                    return;
                }

                // Step 2: 24h Delay Breakeven Stop
                if (elapsedHours >= 24) {
                    if (!pos.be_activated) {
                        const mfe = pos.max_price_move_pct || 0;
                        if (mfe >= 2.0) { // Trade achieved MFE >= 2.0% during first 24h
                            // If current price at 24h mark is already below BE (+0.10%), market exit immediately
                            if (priceMovePct < 0.10) {
                                console.log(`[ExtremeBreakout] 24h Delay BE Market Exit: MFE was ${mfe.toFixed(2)}% but current price is below BE (+0.10%). Exiting.`);
                                closePosition(pos.user_id, currentPrice);
                                return;
                            } else {
                                console.log(`[ExtremeBreakout] 24h Delay BE Activated: MFE was ${mfe.toFixed(2)}%. Stop raised to entry ± 0.10%.`);
                                pos.be_activated = 1;
                                db.run(`UPDATE positions SET be_activated = 1 WHERE id = ?`, [pos.id]);
                            }
                        }
                    } else {
                        // BE Stop is active: exit if price touches entry ± 0.10%
                        let beHit = false;
                        if (pos.side === 'LONG' && currentPrice <= pos.entry_price * 1.0010) {
                            beHit = true;
                        } else if (pos.side === 'SHORT' && currentPrice >= pos.entry_price * 0.9990) {
                            beHit = true;
                        }
                        if (beHit) {
                            console.log(`[ExtremeBreakout] Breakeven Stop Hit for user ${pos.user_id}. Price: ${currentPrice}, Entry: ${pos.entry_price}`);
                            closePosition(pos.user_id, currentPrice);
                            return;
                        }
                    }
                }
            }
        });
    });
}

module.exports = {
    setNotifyUserFunction,
    openPositionInternal,
    closePosition,
    checkTPSL,
    closingUsers,
    openingUsers
};
