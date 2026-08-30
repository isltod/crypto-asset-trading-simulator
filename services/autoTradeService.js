const path = require('path');
const fs = require('fs');
const { db } = require('../config/db');
const { klineHistories, klineHistoriesMTF } = require('./marketService');
const { aggregateKlines, calculateWaveTrend, calculateMACDForKlines, calculateStochRSI, calculateVWAPClimax } = require('./indicatorService');
const { openPositionInternal, closePosition } = require('./tradeService');

let ort = null;
try {
    ort = require('onnxruntime-node');
    console.log("[ONNX] onnxruntime-node module loaded successfully.");
} catch (e) {
    console.log("[ONNX] onnxruntime-node is not installed. RL auto-trading signals will be disabled. Run 'npm install onnxruntime-node' to enable it.");
}

let rlModelSession = null;
let rlModelConfig = null;

async function loadRLModel() {
    if (!ort) return;
    const onnxPath = path.join(__dirname, '..', 'public_models', 'btc_1m.onnx');
    const configPath = path.join(__dirname, '..', 'public_models', 'btc_1m_config.json');
    
    if (fs.existsSync(onnxPath) && fs.existsSync(configPath)) {
        try {
            rlModelConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            rlModelSession = await ort.InferenceSession.create(onnxPath);
            console.log("[ONNX] RL model and config loaded successfully.");
        } catch (e) {
            console.error("[ONNX] Error loading RL model/config:", e.message);
        }
    } else {
        console.log("[ONNX] RL model files not found in public_models/. Place btc_1m.onnx and btc_1m_config.json there to enable RL signals.");
    }
}

if (ort) {
    const modelsDir = path.join(__dirname, '..', 'public_models');
    if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
    }
    fs.watch(modelsDir, (eventType, filename) => {
        if (filename && (filename.includes('btc_1m.onnx') || filename.includes('btc_1m_config.json'))) {
            console.log("[ONNX] Model file change detected. Reloading RL model...");
            setTimeout(loadRLModel, 1000);
        }
    });
    loadRLModel();
}

function calculateRLFeatures(history, config) {
    const window = config.window;
    const lags = config.lags;
    const mu = config.mu;
    const std = config.std;
    
    const needed = window + lags;
    if (history.length < needed) return null;
    
    const slice = history.slice(-needed);
    const closes = slice.map(c => c.close);
    
    const r = [];
    for (let i = 1; i < closes.length; i++) {
        r.push(Math.log(closes[i] / closes[i - 1]));
    }
    
    const featureMatrix = [];
    const startIdx = closes.length - lags;
    for (let idx = startIdx; idx < closes.length; idx++) {
        const closeVal = closes[idx];
        
        let sumClose = 0;
        for (let i = 0; i < window; i++) {
            sumClose += closes[idx - i];
        }
        const sVal = sumClose / window;
        
        const rIdx = idx - 1;
        const rVal = r[rIdx];
        
        let sumR = 0;
        for (let i = 0; i < window; i++) {
            sumR += r[rIdx - i];
        }
        const mVal = sumR / window;
        
        let sumRSq = 0;
        for (let i = 0; i < window; i++) {
            sumRSq += Math.pow(r[rIdx - i] - mVal, 2);
        }
        const vVal = Math.sqrt(sumRSq / (window - 1));
        
        const normClose = (closeVal - mu.close) / std.close;
        const normR = (rVal - mu.r) / std.r;
        const normS = (sVal - mu.s) / std.s;
        const normM = (mVal - mu.m) / std.m;
        const normV = (vVal - mu.v) / std.v;
        
        featureMatrix.push([normClose, normR, normS, normM, normV]);
    }
    
    return Float32Array.from(featureMatrix.flat());
}

async function getRLSignal(symbol) {
    if (!rlModelSession || !rlModelConfig) return 'HOLD';
    const history = klineHistories[symbol];
    if (!history) return 'HOLD';
    
    try {
        const features = calculateRLFeatures(history, rlModelConfig);
        if (!features) return 'HOLD';
        
        const shape = [1, rlModelConfig.lags, rlModelConfig.features.length];
        const inputTensor = new ort.Tensor('float32', features, shape);
        
        const results = await rlModelSession.run({ input: inputTensor });
        const output = results.output.data;
        
        const actionScore0 = output[0];
        const actionScore1 = output[1];
        
        const action = actionScore1 > actionScore0 ? 1 : 0;
        return action === 1 ? 'LONG' : 'SHORT';
    } catch (e) {
        console.error("[ONNX Run Error]:", e.message);
        return 'HOLD';
    }
}

function checkAutoTradeSignals(symbol, currentPrice, isClosed) {
    const history = klineHistories[symbol];
    if (!history || history.length < 50) return;

    db.all(`SELECT a.*, u.username FROM accounts a JOIN users u ON a.user_id = u.id WHERE a.auto_trade_enabled = 1 AND a.signal_type IN ('wave_trend', 'rl_model', 'mtf_macd', 'stoch_rsi', 'v_climax')`, (err, accounts) => {
        if (err || !accounts || accounts.length === 0) return;

        accounts.forEach(async (account) => {
            if (account.symbol && account.symbol !== symbol) return;

            const userId = account.user_id;
            let signal = null;

            if (account.signal_type === 'wave_trend') {
                const tf = account.wt_tf || '5m';
                const n1 = account.wt_n1;
                const n2 = account.wt_n2;
                const sigLen = account.wt_sig;
                const obLevel = account.wt_ob;
                const allowRepaint = account.wt_allow_repaint === 1;

                if (!isClosed && !allowRepaint) return;

                const aggregated = aggregateKlines(history, tf, symbol, klineHistoriesMTF);
                const wt = calculateWaveTrend(aggregated, n1, n2, sigLen);
                const len = wt.wt1Data.length;
                if (len < 2) return;

                const currentTick = history[history.length - 1];
                if (currentTick) {
                    const tfMap = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
                    const duration = tfMap[tf] || 300;
                    const tClose = currentTick.time + 60;

                    if (allowRepaint || (tClose % duration === 0 && isClosed)) {
                        let prevWt1, prevWt2, currWt1, currWt2;

                        if (allowRepaint) {
                            const lastIdx = wt.wt1Data.length - 1;
                            if (lastIdx >= 1) {
                                currWt1 = wt.wt1Data[lastIdx];
                                currWt2 = wt.wt2Data[lastIdx];
                                prevWt1 = wt.wt1Data[lastIdx - 1];
                                prevWt2 = wt.wt2Data[lastIdx - 1];
                            }
                        } else {
                            const tStartCurr = tClose - duration;
                            const tStartPrev = tClose - 2 * duration;

                            const idxCurr = aggregated.findIndex(k => k.time === tStartCurr);
                            const idxPrev = aggregated.findIndex(k => k.time === tStartPrev);

                            if (idxCurr !== -1 && idxPrev !== -1) {
                                currWt1 = wt.wt1Data[idxCurr];
                                currWt2 = wt.wt2Data[idxCurr];
                                prevWt1 = wt.wt1Data[idxPrev];
                                prevWt2 = wt.wt2Data[idxPrev];
                            }
                        }

                        if (prevWt1 !== undefined && prevWt2 !== undefined && currWt1 !== undefined && currWt2 !== undefined &&
                            prevWt1 !== null && prevWt2 !== null && currWt1 !== null && currWt2 !== null) {
                            const ignoreObos = account.wt_ignore_obos === 1;
                            if (prevWt1 < prevWt2 && currWt1 > currWt2 && (ignoreObos || currWt1 < -obLevel)) {
                                signal = 'LONG';
                            } else if (prevWt1 > prevWt2 && currWt1 < currWt2 && (ignoreObos || currWt1 > obLevel)) {
                                signal = 'SHORT';
                            }
                        }
                    }
                }
            } else if (account.signal_type === 'mtf_macd') {
                const tf = account.macd_tf || '5m';
                const fast = account.macd_fast || 12;
                const slow = account.macd_slow || 26;
                const sig = account.macd_sig || 9;
                const allowRepaint = account.macd_allow_repaint === 1;

                if (!isClosed && !allowRepaint) return;

                const aggregated = aggregateKlines(history, tf, symbol, klineHistoriesMTF);
                const macdResult = calculateMACDForKlines(aggregated, fast, slow, sig);
                
                const currentTick = history[history.length - 1];
                if (currentTick) {
                    const tfMap = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
                    const duration = tfMap[tf] || 300;
                    const tClose = currentTick.time + 60;

                    if (allowRepaint || (tClose % duration === 0 && isClosed)) {
                        let prevMacd, prevSig, currMacd, currSig;

                        if (allowRepaint) {
                            const lastIdx = macdResult.macdLine.length - 1;
                            if (lastIdx >= 1) {
                                currMacd = macdResult.macdLine[lastIdx];
                                currSig = macdResult.signalLine[lastIdx];
                                prevMacd = macdResult.macdLine[lastIdx - 1];
                                prevSig = macdResult.signalLine[lastIdx - 1];
                            }
                        } else {
                            const tStartCurr = tClose - duration;
                            const tStartPrev = tClose - 2 * duration;

                            const idxCurr = aggregated.findIndex(k => k.time === tStartCurr);
                            const idxPrev = aggregated.findIndex(k => k.time === tStartPrev);

                            if (idxCurr !== -1 && idxPrev !== -1) {
                                prevMacd = macdResult.macdLine[idxPrev];
                                prevSig = macdResult.signalLine[idxPrev];
                                currMacd = macdResult.macdLine[idxCurr];
                                currSig = macdResult.signalLine[idxCurr];
                            }
                        }

                        if (prevMacd !== undefined && prevSig !== undefined && currMacd !== undefined && currSig !== undefined) {
                            if (prevMacd < prevSig && currMacd > currSig) {
                                signal = 'LONG';
                            } else if (prevMacd > prevSig && currMacd < currSig) {
                                signal = 'SHORT';
                            }
                        }
                    }
                }
            } else if (account.signal_type === 'stoch_rsi') {
                const tf = account.stoch_tf || '5m';
                const rsiPeriod = account.stoch_rsi_len || 14;
                const stochPeriod = account.stoch_len || 14;
                const kPeriod = account.stoch_k || 3;
                const dPeriod = account.stoch_d || 3;
                const allowRepaint = account.stoch_allow_repaint === 1;

                if (!isClosed && !allowRepaint) return;

                const aggregated = aggregateKlines(history, tf, symbol, klineHistoriesMTF);
                const stochResult = calculateStochRSI(aggregated, rsiPeriod, stochPeriod, kPeriod, dPeriod);
                
                const currentTick = history[history.length - 1];
                if (currentTick) {
                    const tfMap = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
                    const duration = tfMap[tf] || 300;
                    const tClose = currentTick.time + 60;

                    if (allowRepaint || (tClose % duration === 0 && isClosed)) {
                        let prevK, prevD, currK, currD;

                        if (allowRepaint) {
                            const lastIdx = stochResult.kLine.length - 1;
                            if (lastIdx >= 1) {
                                currK = stochResult.kLine[lastIdx];
                                currD = stochResult.dLine[lastIdx];
                                prevK = stochResult.kLine[lastIdx - 1];
                                prevD = stochResult.dLine[lastIdx - 1];
                            }
                        } else {
                            const tStartCurr = tClose - duration;
                            const tStartPrev = tClose - 2 * duration;

                            const idxCurr = aggregated.findIndex(k => k.time === tStartCurr);
                            const idxPrev = aggregated.findIndex(k => k.time === tStartPrev);

                            if (idxCurr !== -1 && idxPrev !== -1) {
                                currK = stochResult.kLine[idxCurr];
                                currD = stochResult.dLine[idxCurr];
                                prevK = stochResult.kLine[idxPrev];
                                prevD = stochResult.dLine[idxPrev];
                            }
                        }

                        if (prevK !== null && prevD !== null && currK !== null && currD !== null &&
                            prevK !== undefined && prevD !== undefined && currK !== undefined && currD !== undefined) {
                            
                            if (prevK <= prevD && currK > currD && (currK <= 20 || prevK <= 20)) {
                                signal = 'LONG';
                            } else if (prevK >= prevD && currK < currD && (currK >= 80 || prevK >= 80)) {
                                signal = 'SHORT';
                            }
                        }
                    }
                }
            } else if (account.signal_type === 'v_climax') {
                const tf = account.v_tf || '15m';
                const window = account.v_vwap_window || 96;
                const sigma = account.v_vwap_sigma !== undefined ? account.v_vwap_sigma : 2.0;
                const volLookback = account.v_vol_lookback || 30;
                const volMult = account.v_vol_mult !== undefined ? account.v_vol_mult : 1.8;
                const wickRatio = account.v_wick_ratio !== undefined ? account.v_wick_ratio : 0.8;
                const allowRepaint = account.v_allow_repaint === 1;

                if (!isClosed && !allowRepaint) return;

                const aggregated = aggregateKlines(history, tf, symbol, klineHistoriesMTF);
                const vResult = calculateVWAPClimax(aggregated, window, sigma, volLookback, volMult, wickRatio);

                const currentTick = history[history.length - 1];
                if (currentTick) {
                    const tfMap = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
                    const duration = tfMap[tf] || 900;
                    const tClose = currentTick.time + 60;

                    if (allowRepaint || (tClose % duration === 0 && isClosed)) {
                        let sigVal = 0;
                        if (allowRepaint) {
                            const lastIdx = vResult.signals.length - 1;
                            if (lastIdx >= 0) {
                                sigVal = vResult.signals[lastIdx];
                            }
                        } else {
                            const tStartCurr = tClose - duration;
                            const idxCurr = aggregated.findIndex(k => k.time === tStartCurr);
                            if (idxCurr !== -1) {
                                sigVal = vResult.signals[idxCurr];
                            }
                        }

                        if (sigVal === 1) {
                            signal = 'LONG';
                        } else if (sigVal === -1) {
                            signal = 'SHORT';
                        }
                    }
                }
            } else if (account.signal_type === 'rl_model') {
                if (!isClosed) return;
                signal = await getRLSignal(symbol);
            }

            if (signal && signal !== 'HOLD') {
                console.log(`[AutoTrade] Signal ${signal} detected via ${account.signal_type} for user ${account.username} (${userId}) on ${symbol}. Price: ${currentPrice}`);
                db.get(`SELECT * FROM positions WHERE user_id = ?`, [userId], (err, pos) => {
                    if (err) return;
                    
                    if (pos) {
                        if (pos.symbol !== symbol) {
                            console.log(`[AutoTrade] User ${account.username} already has an active position on ${pos.symbol}. Skipping signal on ${symbol}.`);
                            return;
                        }
                        
                        if (pos.side === signal) {
                            console.log(`[AutoTrade] User ${account.username} already has a ${signal} position on ${symbol}. Skipping.`);
                        } else {
                            console.log(`[AutoTrade] Opposite signal ${signal} detected. Closing current ${pos.side} position on ${symbol} for ${account.username}`);
                            closePosition(userId, currentPrice, null, (success) => {
                                if (success) {
                                    setTimeout(() => {
                                        openPositionInternal(userId, symbol, signal, currentPrice);
                                    }, 500);
                                }
                            });
                        }
                    } else {
                        openPositionInternal(userId, symbol, signal, currentPrice);
                    }
                });
            }
        });
    });
}

module.exports = {
    checkAutoTradeSignals,
    getRLSignal
};
