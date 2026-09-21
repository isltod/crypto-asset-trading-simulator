const assert = require('assert');

// Test calculateVolumeBarData logic in CommonJS test
function calculateVolumeBarData(formattedData) {
    if (!formattedData || formattedData.length === 0) return [];
    const len = formattedData.length;
    const lookback24h = Math.min(len, 1440);

    let sumVol24h = 0;
    for (let i = len - lookback24h; i < len; i++) {
        sumVol24h += formattedData[i].volume || 0;
    }
    const avg24h1mVol = sumVol24h / lookback24h;

    const volBars = [];
    for (let i = 0; i < len; i++) {
        const d = formattedData[i];
        const v = d.volume || 0;

        let vol15 = 0;
        const start = Math.max(0, i - 14);
        for (let j = start; j <= i; j++) {
            vol15 += formattedData[j].volume || 0;
        }
        const volSurge = vol15 / (avg24h1mVol * 15 + 1e-9);

        let color = d.close >= d.open ? 'rgba(46, 189, 133, 0.45)' : 'rgba(246, 70, 93, 0.45)';
        if (volSurge >= 2.5) {
            color = '#f59e0b';
        }

        volBars.push({
            time: d.time,
            value: v,
            color: color
        });
    }
    return volBars;
}

console.log("=== Testing calculateVolumeBarData & Surge Highlighting ===");

// 1. Create baseline 100 bars with 10 volume each
const bars = [];
for (let i = 0; i < 100; i++) {
    bars.push({
        time: 1700000000 + i * 60,
        open: 50000,
        close: 50010, // green
        volume: 10
    });
}

let result = calculateVolumeBarData(bars);
assert.strictEqual(result.length, 100);
// Normal green bar color
assert.strictEqual(result[50].color, 'rgba(46, 189, 133, 0.45)', "Normal green bar color should be green");

// 2. Inject volume surge at bars 85-99 (40 volume each, surge >= 2.5)
for (let i = 85; i < 100; i++) {
    bars[i].volume = 40;
}

result = calculateVolumeBarData(bars);
// Check bar 99 -> should be highlighted in Gold (#f59e0b)
assert.strictEqual(result[99].color, '#f59e0b', `Volume surge bar should be gold (#f59e0b), got: ${result[99].color}`);
console.log("✔ Volume surge bar highlighted in Gold (#f59e0b) successfully!");

console.log("=== All Volume Bar Tests Passed! ===");
