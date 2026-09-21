const assert = require('assert');

console.log("=== Testing 24h Delay BE & 36h Timeout Exits Logic ===");

function simulateExitDecision(pos, currentPrice, elapsedHours) {
    let priceMovePct = 0;
    if (pos.side === 'LONG') {
        priceMovePct = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
    } else {
        priceMovePct = ((pos.entry_price - currentPrice) / pos.entry_price) * 100;
    }
    const roe = priceMovePct * pos.leverage;

    // Update MFE
    if (priceMovePct > (pos.max_price_move_pct || 0)) {
        pos.max_price_move_pct = priceMovePct;
    }

    // Liquidation
    if (roe <= -100) return 'LIQUIDATION';

    // Step 1: Hard TP/SL
    if (pos.tpsl_enabled) {
        if (roe >= pos.tp_roi) return 'HARD_TP';
        if (roe <= pos.sl_roi) return 'HARD_SL';
    }

    // Step 2 & 3: Extreme Breakout dynamic exits
    if (pos.signal_type === 'extreme_breakout' && pos.entry_type === 'AUTO') {
        // Step 3: 36h Timeout
        if (elapsedHours >= 36) {
            return 'TIMEOUT_36H';
        }

        // Step 2: 24h Delay BE
        if (elapsedHours >= 24) {
            if (!pos.be_activated) {
                const mfe = pos.max_price_move_pct || 0;
                if (mfe >= 2.0) {
                    if (priceMovePct < 0.10) {
                        return 'BE_MARKET_EXIT';
                    } else {
                        pos.be_activated = 1;
                    }
                }
            } else {
                if (pos.side === 'LONG' && currentPrice <= pos.entry_price * 1.0010) {
                    return 'BE_STOP_HIT';
                }
                if (pos.side === 'SHORT' && currentPrice >= pos.entry_price * 0.9990) {
                    return 'BE_STOP_HIT';
                }
            }
        }
    }

    return 'HOLD';
}

// Case 1: Within 24h, normal pullback -> should HOLD
const pos1 = {
    side: 'LONG',
    entry_price: 60000,
    leverage: 10,
    tpsl_enabled: 1,
    tp_roi: 30, // +3.0% price
    sl_roi: -100, // -10.0% price
    signal_type: 'extreme_breakout',
    entry_type: 'AUTO',
    max_price_move_pct: 1.5,
    be_activated: 0
};
assert.strictEqual(simulateExitDecision(pos1, 59500, 10), 'HOLD', "10h normal fluctuation should HOLD");
console.log("✔ Case 1: 10h normal fluctuation correctly holds");

// Case 2: 24h reached, MFE was +2.5%, but current price dropped below BE (0.0% move) -> Immediate Market Exit!
const pos2 = {
    side: 'LONG',
    entry_price: 60000,
    leverage: 10,
    tpsl_enabled: 1,
    tp_roi: 30,
    sl_roi: -100,
    signal_type: 'extreme_breakout',
    entry_type: 'AUTO',
    max_price_move_pct: 2.5,
    be_activated: 0
};
assert.strictEqual(simulateExitDecision(pos2, 60000, 24.1), 'BE_MARKET_EXIT', "24h with MFE >= 2% but price below BE should trigger immediate exit");
console.log("✔ Case 2: 24h market exit triggered correctly when price under BE");

// Case 3: 24h reached, MFE +2.5%, current price at +1.0% -> Activate BE stop
const pos3 = {
    side: 'LONG',
    entry_price: 60000,
    leverage: 10,
    tpsl_enabled: 1,
    tp_roi: 30,
    sl_roi: -100,
    signal_type: 'extreme_breakout',
    entry_type: 'AUTO',
    max_price_move_pct: 2.5,
    be_activated: 0
};
assert.strictEqual(simulateExitDecision(pos3, 60600, 24.1), 'HOLD', "Should activate BE and hold while price > BE");
assert.strictEqual(pos3.be_activated, 1, "BE should be marked activated");

// Next tick, price drops to entry + 0.10% ($60,060) -> BE Stop Hit!
assert.strictEqual(simulateExitDecision(pos3, 60050, 25.0), 'BE_STOP_HIT', "Should exit on touching BE stop");
console.log("✔ Case 3: 24h BE activated and stopped out at entry + 0.10%");

// Case 4: 36h reached without TP/SL -> Timeout Exit!
const pos4 = {
    side: 'LONG',
    entry_price: 60000,
    leverage: 10,
    tpsl_enabled: 1,
    tp_roi: 30,
    sl_roi: -100,
    signal_type: 'extreme_breakout',
    entry_type: 'AUTO',
    max_price_move_pct: 1.0, // never hit 2%
    be_activated: 0
};
assert.strictEqual(simulateExitDecision(pos4, 60200, 36.1), 'TIMEOUT_36H', "36h reached should trigger timeout exit");
console.log("✔ Case 4: 36h timeout exit triggered correctly");

console.log("=== All Dynamic Exit Logic Tests Passed! ===");

