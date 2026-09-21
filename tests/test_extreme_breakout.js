const assert = require('assert');
const { calculateExtremeBreakout } = require('../services/indicatorService');

console.log("=== Testing calculateExtremeBreakout & A1 Filter ===");

// 1. Generate baseline klines (1440 bars) with constant volume and flat prices
const klines = [];
const baseTime = 1600000000;
for (let i = 0; i < 1440; i++) {
    klines.push({
        time: baseTime + i * 60,
        open: 50000,
        high: 50010,
        low: 49990,
        close: 50000,
        volume: 10
    });
}

// Check with flat market -> should be HOLD
let sig = calculateExtremeBreakout(klines);
assert.strictEqual(sig, 'HOLD', "Flat market should return HOLD");
console.log("✔ Flat market test passed (HOLD)");

// 2. Inject strong LONG breakout at the end
// 15m return >= 0.7%, volume >= 2.5x, ER >= 0.45
for (let i = 1425; i < 1440; i++) {
    const step = (i - 1425 + 1);
    klines[i].close = 50000 + step * 35; // +525 (+1.05%)
    klines[i].high = klines[i].close + 5;
    klines[i].low = klines[i].close - 5;
    klines[i].volume = 30; // 3x average volume
}

sig = calculateExtremeBreakout(klines);
assert.strictEqual(sig, 'LONG', `Breakout should return LONG, got: ${sig}`);
console.log("✔ Long breakout test passed (LONG)");

// 3. Test A1 Filter: Inject previous run length >= 5
// Place a 5-bar signal run earlier (e.g. at bars 1390-1394), followed by quiet bars (1395-1424)
// Previous run:
for (let i = 1380; i < 1395; i++) {
    klines[i].close = 50000 + (i - 1380 + 1) * 30;
    klines[i].high = klines[i].close + 5;
    klines[i].low = klines[i].close - 5;
    klines[i].volume = 30;
}
// Quiet bars between 1395 and 1424
for (let i = 1395; i < 1425; i++) {
    klines[i].close = 50450;
    klines[i].high = 50455;
    klines[i].low = 50445;
    klines[i].volume = 10;
}

sig = calculateExtremeBreakout(klines);
// With previous run >= 5 bars, A1 filter should skip entry and return HOLD!
assert.strictEqual(sig, 'HOLD', `A1 filter should block entry after prev run >= 5, got: ${sig}`);
console.log("✔ A1 filter test passed: blocked entry when prev run >= 5 bars (HOLD)");

console.log("=== All Indicator & A1 Filter Tests Passed Successfully! ===");

