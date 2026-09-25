const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9222;
const APP_URL = "http://localhost:8080/cats/";
const SCREENSHOT_PATH = path.join(__dirname, "cats_browser_test.png");
const USER_DATA_DIR = path.join(__dirname, ".chrome_test_profile");

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runBrowserTest() {
    console.log("=== Starting Headless Chrome Browser Test ===");

    const chromeProc = spawn(CHROME_PATH, [
        `--remote-debugging-port=${PORT}`,
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1600,1000',
        `--user-data-dir=${USER_DATA_DIR}`,
        'about:blank'
    ]);

    chromeProc.on('error', (err) => {
        console.error("Failed to spawn Chrome:", err);
    });

    console.log("Waiting for Chrome DevTools endpoint...");
    let versionInfo = null;
    for (let i = 0; i < 20; i++) {
        await sleep(500);
        try {
            versionInfo = await getJson(`http://127.0.0.1:${PORT}/json/version`);
            if (versionInfo && versionInfo.webSocketDebuggerUrl) break;
        } catch (e) { }
    }

    if (!versionInfo || !versionInfo.webSocketDebuggerUrl) {
        throw new Error("Could not connect to Chrome DevTools endpoint!");
    }
    console.log("✔ Connected to Chrome DevTools:", versionInfo['Browser']);

    const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    if (!pageTarget) {
        throw new Error("No page target found in Chrome!");
    }
    const pageWsUrl = pageTarget.webSocketDebuggerUrl;

    const ws = new WebSocket(pageWsUrl);
    await new Promise((res, rej) => {
        ws.on('open', res);
        ws.on('error', rej);
    });

    let msgId = 1;
    const pendingRequests = new Map();
    const consoleLogs = [];
    const jsErrors = [];

    ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.id && pendingRequests.has(msg.id)) {
            const { resolve, reject } = pendingRequests.get(msg.id);
            pendingRequests.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        } else if (msg.method === 'Runtime.consoleAPICalled') {
            const text = msg.params.args.map(a => a.value !== undefined ? a.value : JSON.stringify(a)).join(' ');
            consoleLogs.push(`[Browser ${msg.params.type}] ${text}`);
        } else if (msg.method === 'Runtime.exceptionThrown') {
            const desc = msg.params.exceptionDetails.exception ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text;
            jsErrors.push(`[Browser Exception] ${desc}`);
        }
    });

    function sendCDP(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = msgId++;
            pendingRequests.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    await sendCDP('Page.enable');
    await sendCDP('Runtime.enable');
    await sendCDP('DOM.enable');

    console.log("Navigating to:", APP_URL);
    await sendCDP('Page.navigate', { url: APP_URL });

    console.log("Waiting 6 seconds for klines and chart initialization...");
    await sleep(6000);

    console.log("\n--- Checking DOM Elements & UI State ---");
    const evalResult = await sendCDP('Runtime.evaluate', {
        expression: `
            (() => {
                const toggleFork7 = document.getElementById('toggle-fork7');
                const signalSelect = document.getElementById('signal-select');
                const chartContainer = document.getElementById('chart-container');
                const fork7Option = signalSelect ? signalSelect.querySelector('option[value="fork7_candidate3"]') : null;
                const canvasCount = chartContainer ? chartContainer.querySelectorAll('canvas').length : 0;
                
                if (signalSelect && fork7Option) {
                    signalSelect.value = 'fork7_candidate3';
                    signalSelect.dispatchEvent(new Event('change'));
                }

                return {
                    title: document.title,
                    toggleFork7Exists: !!toggleFork7,
                    toggleFork7Checked: toggleFork7 ? toggleFork7.checked : false,
                    signalSelectExists: !!signalSelect,
                    signalSelectValue: signalSelect ? signalSelect.value : null,
                    fork7OptionExists: !!fork7Option,
                    fork7OptionText: fork7Option ? fork7Option.textContent : null,
                    canvasCount: canvasCount,
                    hasKlines: window.state && window.state.klineData ? window.state.klineData.length : 0
                };
            })()
        `,
        returnByValue: true
    });

    const domInfo = evalResult.result.value;
    console.log("Page Title:", domInfo.title);
    console.log("Toggle Fork 7 Exists:", domInfo.toggleFork7Exists);
    console.log("Toggle Fork 7 Checked:", domInfo.toggleFork7Checked);
    console.log("Signal Select Exists:", domInfo.signalSelectExists);
    console.log("Fork 7 Option Exists:", domInfo.fork7OptionExists, `("${domInfo.fork7OptionText}")`);
    console.log("Signal Select Current Value:", domInfo.signalSelectValue);
    console.log("Chart Canvas Elements Rendered:", domInfo.canvasCount);

    console.log("\n--- Testing calculateFork7Candidate3Markers Execution in Browser ---");
    const testCalcResult = await sendCDP('Runtime.evaluate', {
        expression: `
            (async () => {
                try {
                    const { calculateFork7Candidate3Markers } = await import('./js/indicators.js');
                    const mockBars = [];
                    const base = 1700000000;
                    for (let i = 0; i < 1500; i++) {
                        mockBars.push({
                            time: base + i * 60,
                            open: 50000,
                            high: 50020,
                            low: 49980,
                            close: 50000,
                            volume: 100
                        });
                    }
                    mockBars[1499].close = 50250;
                    mockBars[1499].high = 50260;
                    mockBars[1499].volume = 200;

                    const markers = calculateFork7Candidate3Markers(mockBars);
                    return { success: true, markersCount: markers.length, markers: markers };
                } catch (e) {
                    return { success: false, error: e.stack || e.message };
                }
            })()
        `,
        awaitPromise: true,
        returnByValue: true
    });

    console.log("calculateFork7Candidate3Markers Result:", JSON.stringify(testCalcResult.result.value, null, 2));

    console.log("\n--- Capturing Screenshot ---");
    const screenshot = await sendCDP('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(screenshot.data, 'base64');
    fs.writeFileSync(SCREENSHOT_PATH, buffer);
    console.log(`✔ Screenshot saved to: ${SCREENSHOT_PATH} (${(buffer.length / 1024).toFixed(1)} KB)`);

    console.log("\n--- Console Output & Errors ---");
    console.log(`Total console logs: ${consoleLogs.length}`);
    if (jsErrors.length === 0) {
        console.log("✔ Zero JavaScript exceptions detected!");
    } else {
        console.error("JavaScript Exceptions found:");
        jsErrors.forEach(err => console.error(err));
    }

    ws.close();
    chromeProc.kill();
    try {
        fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
    } catch (e) { }

    console.log("\n=== Browser Test Finished Successfully! 🎉 ===");
}

runBrowserTest().catch(err => {
    console.error("Browser test failed:", err);
    process.exit(1);
});
