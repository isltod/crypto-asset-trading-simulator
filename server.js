const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = 'cats_super_secret_key_for_demo'; // In production, use env variable
const PORT = process.env.PORT || 8080;
const INITIAL_CAPITAL = 100;
const BASE_PATH = '/cats';

let lastBinanceMessageTime = 0;
let binanceStatus = "connecting";
let binanceError = null;

// Middleware
app.use(express.json());
app.use(cors());
app.use(BASE_PATH, express.static(path.join(__dirname, '/')));
app.get('/', (req, res) => res.redirect(BASE_PATH + '/'));

// Database setup
const db = new sqlite3.Database('cats.sqlite', (err) => {
    if (err) console.error("DB connection error:", err);
    else console.log("Connected to SQLite.");
});

// Initialize tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS accounts (
        user_id INTEGER PRIMARY KEY,
        virtual_capital REAL NOT NULL DEFAULT ${INITIAL_CAPITAL},
        leverage INTEGER NOT NULL DEFAULT 1,
        tpsl_enabled BOOLEAN NOT NULL DEFAULT 0,
        tp_roi REAL NOT NULL DEFAULT 10,
        sl_roi REAL NOT NULL DEFAULT -5,
        auto_trade_enabled BOOLEAN NOT NULL DEFAULT 0,
        signal_type TEXT NOT NULL DEFAULT 'none',
        wt_n1 INTEGER NOT NULL DEFAULT 10,
        wt_n2 INTEGER NOT NULL DEFAULT 21,
        wt_sig INTEGER NOT NULL DEFAULT 4,
        wt_ob INTEGER NOT NULL DEFAULT 53,
        symbol TEXT NOT NULL DEFAULT 'BTCUSDT',
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        size REAL NOT NULL,
        margin REAL NOT NULL,
        leverage INTEGER NOT NULL,
        entry_fee REAL NOT NULL,
        capital_before REAL NOT NULL,
        entry_time DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        entry_type TEXT NOT NULL DEFAULT 'MANUAL',
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS trade_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        pnl REAL NOT NULL,
        roe REAL NOT NULL,
        fee REAL NOT NULL,
        capital_before REAL NOT NULL,
        capital_after REAL NOT NULL,
        leverage INTEGER DEFAULT 1,
        entry_time DATETIME NOT NULL,
        exit_time DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    db.run(`ALTER TABLE trade_history ADD COLUMN leverage INTEGER DEFAULT 1`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN auto_trade_enabled BOOLEAN NOT NULL DEFAULT 0`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN signal_type TEXT NOT NULL DEFAULT 'none'`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_n1 INTEGER NOT NULL DEFAULT 10`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_n2 INTEGER NOT NULL DEFAULT 21`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_sig INTEGER NOT NULL DEFAULT 4`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_ob INTEGER NOT NULL DEFAULT 53`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN symbol TEXT NOT NULL DEFAULT 'BTCUSDT'`, (err) => {});
    db.run(`ALTER TABLE positions ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'MANUAL'`, (err) => {});
    db.run(`ALTER TABLE trade_history ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'MANUAL'`, (err) => {});
});

// Auth Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Routes
app.post(`${BASE_PATH}/api/auth/register`, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });

    try {
        const hash = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password_hash) VALUES (?, ?)`, [username, hash], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ error: "Username already exists" });
                return res.status(500).json({ error: err.message });
            }
            const userId = this.lastID;
            db.run(`INSERT INTO accounts (user_id, virtual_capital) VALUES (?, ?)`, [userId, INITIAL_CAPITAL]);
            res.json({ message: "Registration successful" });
        });
    } catch (e) {
        res.status(500).json({ error: "Server error" });
    }
});

app.post(`${BASE_PATH}/api/auth/login`, (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(400).json({ error: "Invalid credentials" });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ error: "Invalid credentials" });

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, username });
    });
});

app.get(`${BASE_PATH}/api/account`, authenticateToken, (req, res) => {
    const userId = req.user.userId;
    db.get(`SELECT * FROM accounts WHERE user_id = ?`, [userId], (err, account) => {
        if (err || !account) return res.status(500).json({ error: "Account not found" });
        db.get(`SELECT * FROM positions WHERE user_id = ? LIMIT 1`, [userId], (err, position) => {
            res.json({ account, activePosition: position || null });
        });
    });
});

app.post(`${BASE_PATH}/api/account/recharge`, authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const newCapital = parseFloat(req.body.virtual_capital) || INITIAL_CAPITAL;
    if (newCapital < 0) return res.status(400).json({ error: "Invalid capital amount" });
    
    db.run(`UPDATE accounts SET virtual_capital = ? WHERE user_id = ?`, [newCapital, userId], function(err) {
        if (err) return res.status(500).json({ error: "Failed to set capital" });
        res.json({ message: "Capital updated successfully", virtual_capital: newCapital });
    });
});

app.post(`${BASE_PATH}/api/account/config`, authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const { 
        leverage, 
        tpsl_enabled, 
        tp_roi, 
        sl_roi, 
        auto_trade_enabled, 
        signal_type, 
        wt_n1, 
        wt_n2, 
        wt_sig, 
        wt_ob,
        symbol
    } = req.body;

    db.get(`SELECT * FROM accounts WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) return res.status(500).json({ error: "Account not found" });

        const updatedLeverage = leverage !== undefined ? leverage : row.leverage;
        const updatedTpsl = tpsl_enabled !== undefined ? (tpsl_enabled ? 1 : 0) : row.tpsl_enabled;
        const updatedTp = tp_roi !== undefined ? tp_roi : row.tp_roi;
        const updatedSl = sl_roi !== undefined ? sl_roi : row.sl_roi;
        const updatedAutoTrade = auto_trade_enabled !== undefined ? (auto_trade_enabled ? 1 : 0) : row.auto_trade_enabled;
        const updatedSignalType = signal_type !== undefined ? signal_type : row.signal_type;
        const updatedWtN1 = wt_n1 !== undefined ? wt_n1 : row.wt_n1;
        const updatedWtN2 = wt_n2 !== undefined ? wt_n2 : row.wt_n2;
        const updatedWtSig = wt_sig !== undefined ? wt_sig : row.wt_sig;
        const updatedWtOb = wt_ob !== undefined ? wt_ob : row.wt_ob;
        const updatedSymbol = symbol !== undefined ? symbol : row.symbol;

        db.run(`UPDATE accounts SET 
            leverage = ?, tpsl_enabled = ?, tp_roi = ?, sl_roi = ?, 
            auto_trade_enabled = ?, signal_type = ?, 
            wt_n1 = ?, wt_n2 = ?, wt_sig = ?, wt_ob = ?,
            symbol = ?
            WHERE user_id = ?`, 
            [
                updatedLeverage, updatedTpsl, updatedTp, updatedSl, 
                updatedAutoTrade, updatedSignalType, 
                updatedWtN1, updatedWtN2, updatedWtSig, updatedWtOb, 
                updatedSymbol,
                userId
            ], 
            (err) => {
                if (err) return res.status(500).json({ error: "Failed to update config: " + err.message });
                res.json({ message: "Config updated" });
        });
    });
});

// In-memory latest prices for backend logic (TPSL processing)
const latestPrices = {};
const closingUsers = new Set();
const openingUsers = new Set();

app.post(`${BASE_PATH}/api/trade/open`, authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const { side, symbol, currentPrice } = req.body; // Use server's latestPrice if production, using currentPrice from req for simplicity/sync

    const entryPrice = latestPrices[symbol] || currentPrice;
    if (!entryPrice) return res.status(400).json({ error: "Price not available" });

    db.serialize(() => {
        db.get(`SELECT * FROM positions WHERE user_id = ?`, [userId], (err, pos) => {
            if (pos) return res.status(400).json({ error: "Position already open" });

            db.get(`SELECT * FROM accounts WHERE user_id = ?`, [userId], (err, account) => {
                if (!account) return res.status(500).json({ error: "Account error" });
                
                const margin = account.virtual_capital;
                if (margin <= 0) return res.status(400).json({ error: "Insufficient capital" });

                const size = (margin * account.leverage) / entryPrice;
                const feeRate = 0.0005;
                const entryFee = margin * account.leverage * feeRate;

                const newCapital = margin - entryFee;

                db.run(`UPDATE accounts SET virtual_capital = ? WHERE user_id = ?`, [newCapital, userId], (err) => {
                    db.run(`INSERT INTO positions (user_id, symbol, side, entry_price, size, margin, leverage, entry_fee, capital_before, entry_type) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL')`, 
                            [userId, symbol, side, entryPrice, size, margin, account.leverage, entryFee, margin], function(err) {
                        res.json({ message: "Position opened", newCapital });
                    });
                });
            });
        });
    });
});

app.post(`${BASE_PATH}/api/trade/close`, authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const { currentPrice } = req.body;
    closePosition(userId, currentPrice, res);
});

app.get(`${BASE_PATH}/api/history`, authenticateToken, (req, res) => {
    const userId = req.user.userId;
    db.all(`SELECT * FROM trade_history WHERE user_id = ? ORDER BY exit_time DESC`, [userId], (err, rows) => {
        res.json(rows || []);
    });
});

app.delete(`${BASE_PATH}/api/history`, authenticateToken, (req, res) => {
    const userId = req.user.userId;
    db.run(`DELETE FROM trade_history WHERE user_id = ?`, [userId], (err) => {
        res.json({ message: "History cleared" });
    });
});

// Health/Status endpoint
app.get(`${BASE_PATH}/api/status`, (req, res) => {
    const uptime = process.uptime();
    const timeSinceLastMessage = lastBinanceMessageTime ? (Date.now() - lastBinanceMessageTime) / 1000 : null;
    
    res.json({
        status: "ok",
        uptime,
        binance: {
            status: binanceStatus,
            lastMessageSecondsAgo: timeSinceLastMessage,
            error: binanceError
        },
        clientsConnected: wss.clients.size
    });
});


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

        // Prioritize server's latest tracked price for the specific position symbol to prevent cross-symbol price bugs
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
                
                notifyUser(userId, { type: 'position_closed', data: result });
                
                if (res) {
                    res.json({ message: "Position closed", ...result });
                }
                if (cb) cb(true);
            });
        });
    });
}

// WebSocket Connections and Binance Proxy
const connectedClients = new Map(); // ws -> userId (if authenticated)
const userSockets = new Map(); // userId -> ws array // Simplified logic: just map userId to ws connection

wss.on('connection', (ws, req) => {
    // Expected to receive authentication message first
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    
    let userId = null;
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            userId = decoded.userId;
            connectedClients.set(ws, userId);
            
            if (!userSockets.has(userId)) {
                userSockets.set(userId, []);
            }
            userSockets.get(userId).push(ws);
        } catch (e) {
            // Invalid token but allow connection for just viewing market data
        }
    }

    ws.on('close', () => {
        const uid = connectedClients.get(ws);
        if (uid && userSockets.has(uid)) {
            const sockets = userSockets.get(uid);
            userSockets.set(uid, sockets.filter(s => s !== ws));
        }
        connectedClients.delete(ws);
    });

    // Send initial status heartbeat
    ws.send(JSON.stringify({ type: 'hb', time: Date.now() }));
});

// Periodic Heartbeat to keep connections alive (every 30s)
setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'hb', time: Date.now() }));
        }
    });
}, 30000);

function notifyUser(userId, message) {
    const sockets = userSockets.get(userId);
    if (sockets) {
        sockets.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        });
    }
}

// Connect to Binance
let binanceWs = null;
const SYMBOLS_TO_STREAM = ['btcusdt', 'ethusdt', 'solusdt', 'xrpusdt', 'bnbusdt'];

const https = require('https');

function getJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', (err) => reject(err));
    });
}

const klineHistories = {};

async function initKlineHistories() {
    for (const rawSymbol of SYMBOLS_TO_STREAM) {
        const symbol = rawSymbol.toUpperCase();
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=1000`;
        try {
            const data = await getJson(url);
            klineHistories[symbol] = data.map(d => ({
                time: Math.floor(d[0] / 1000),
                open: parseFloat(d[1]),
                high: parseFloat(d[2]),
                low: parseFloat(d[3]),
                close: parseFloat(d[4])
            }));
            console.log(`[Init] Loaded ${klineHistories[symbol].length} klines for ${symbol}`);
        } catch (e) {
            console.error(`[Init] Failed to load klines for ${symbol}:`, e.message);
            klineHistories[symbol] = [];
        }
    }
}

function calculateEMA(values, period) {
    const ema = new Array(values.length).fill(0);
    if (values.length < period) return ema;
    
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += values[i];
    }
    const sma = sum / period;
    ema[period - 1] = sma;
    
    const alpha = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
        ema[i] = values[i] * alpha + ema[i - 1] * (1 - alpha);
    }
    return ema;
}

function calculateWaveTrend(formattedData, n1, n2, sigLen) {
    const len = formattedData.length;
    const wt1Data = [];
    const wt2Data = [];
    if (len < n1 + n2) return { wt1Data, wt2Data };

    const ap = formattedData.map(d => (d.high + d.low + d.close) / 3);
    const esa = calculateEMA(ap, n1);
    
    const absDiff = ap.map((val, idx) => Math.abs(val - esa[idx]));
    const d = calculateEMA(absDiff, n1);
    
    const ci = ap.map((val, idx) => {
        if (d[idx] === 0) return 0;
        return (val - esa[idx]) / (0.015 * d[idx]);
    });
    
    const wt1 = calculateEMA(ci, n2);
    
    const wt2 = new Array(len).fill(0);
    for (let i = sigLen - 1; i < len; i++) {
        let sum = 0;
        for (let j = 0; j < sigLen; j++) {
            sum += wt1[i - j];
        }
        wt2[i] = sum / sigLen;
    }
    
    const startIdx = n1 + n2;
    for (let i = 0; i < len; i++) {
        if (i < startIdx) {
            wt1Data.push(undefined);
            wt2Data.push(undefined);
        } else {
            wt1Data.push(wt1[i]);
            wt2Data.push(wt2[i]);
        }
    }
    
    return { wt1Data, wt2Data };
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
                return; // Position already open
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
                        
                        // Notify client to update UI
                        notifyUser(userId, { type: 'position_opened', data: { symbol, side, entry_price: entryPrice, size, margin, leverage: account.leverage, newCapital, entry_time: new Date().toISOString(), entry_type: 'AUTO' } });
                        if (cb) cb(true);
                    });
                });
            });
        });
    });
}

function checkAutoTradeSignals(symbol, currentPrice) {
    const history = klineHistories[symbol];
    if (!history || history.length < 50) return;

    db.all(`SELECT a.*, u.username FROM accounts a JOIN users u ON a.user_id = u.id WHERE a.auto_trade_enabled = 1 AND a.signal_type = 'wave_trend'`, (err, accounts) => {
        if (err || !accounts || accounts.length === 0) return;

        accounts.forEach(account => {
            // Only process signals for the symbol that the user has configured
            if (account.symbol && account.symbol !== symbol) return;

            const userId = account.user_id;
            const n1 = account.wt_n1;
            const n2 = account.wt_n2;
            const sigLen = account.wt_sig;
            const obLevel = account.wt_ob;
            
            const wt = calculateWaveTrend(history, n1, n2, sigLen);
            const len = wt.wt1Data.length;
            if (len < 2) return;

            const prevWt1 = wt.wt1Data[len - 2];
            const prevWt2 = wt.wt2Data[len - 2];
            const currWt1 = wt.wt1Data[len - 1];
            const currWt2 = wt.wt2Data[len - 1];

            if (prevWt1 === undefined || prevWt2 === undefined || currWt1 === undefined || currWt2 === undefined) return;

            let signal = null;
            if (prevWt1 < prevWt2 && currWt1 > currWt2 && currWt1 < -obLevel) {
                signal = 'LONG';
            } else if (prevWt1 > prevWt2 && currWt1 < currWt2 && currWt1 > obLevel) {
                signal = 'SHORT';
            }

            if (signal) {
                console.log(`[AutoTrade] Signal ${signal} detected for user ${account.username} (${userId}) on ${symbol}. Price: ${currentPrice}`);
                db.get(`SELECT * FROM positions WHERE user_id = ?`, [userId], (err, pos) => {
                    if (err) return;
                    
                    if (pos) {
                        // Check if the open position's symbol matches the signal symbol.
                        // If they don't match, we must ignore the signal since the user already has a position on another symbol.
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

function setupBinanceStream() {
    console.log("Connecting to Binance WebSocket...");
    binanceStatus = "connecting";
    
    // Using combined stream for multi-symbol support
    const streams = SYMBOLS_TO_STREAM.map(s => `${s}@kline_1m`).join('/');
    const endpoint = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    
    binanceWs = new WebSocket(endpoint);
    
    binanceWs.on('open', () => {
        console.log("Connected to Binance Spot WebSocket.");
        binanceStatus = "connected";
        binanceError = null;
    });

    binanceWs.on('message', (data) => {
        try {
            const raw = JSON.parse(data);
            const message = raw.data; // Combined streams wrap data in {stream, data}
            
            if (message && message.e === 'kline') {
                lastBinanceMessageTime = Date.now();
                const symbol = message.s;
                const currentPrice = parseFloat(message.k.c);
                latestPrices[symbol] = currentPrice;

                // klineHistories 업데이트
                if (klineHistories[symbol]) {
                    const tick = {
                        time: Math.floor(message.k.t / 1000),
                        open: parseFloat(message.k.o),
                        high: parseFloat(message.k.h),
                        low: parseFloat(message.k.l),
                        close: currentPrice
                    };
                    const history = klineHistories[symbol];
                    const lastIdx = history.length - 1;
                    if (lastIdx >= 0 && history[lastIdx].time === tick.time) {
                        history[lastIdx] = tick;
                    } else {
                        history.push(tick);
                        if (history.length > 1000) {
                            history.shift();
                        }
                    }
                }

                // Broadcast to all connected clients
                const broadcastData = JSON.stringify(message);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastData);
                    }
                });

                checkTPSL(symbol, currentPrice);

                // 캔들 마감 시 자동거래 신호 분석
                if (message.k.x === true) {
                    checkAutoTradeSignals(symbol, currentPrice);
                }
            }
        } catch (e) {
            console.error("Error parsing Binance message:", e);
        }
    });
    
    binanceWs.on('error', (err) => {
        console.error("Binance WS Error:", err.message);
        binanceStatus = "error";
        binanceError = err.message;
    });

    binanceWs.on('close', () => {
        console.log("Binance WS closed. Reconnecting in 5s...");
        binanceStatus = "disconnected";
        setTimeout(setupBinanceStream, 5000);
    });
}
initKlineHistories().then(() => {
    setupBinanceStream();
}).catch(err => {
    console.error("Failed to initialize kline histories, starting stream anyway:", err);
    setupBinanceStream();
});

function checkTPSL(symbol, currentPrice) {
    db.all(`SELECT p.user_id, p.side, p.entry_price, p.leverage, a.tpsl_enabled, a.tp_roi, a.sl_roi 
            FROM positions p 
            JOIN accounts a ON p.user_id = a.user_id 
            WHERE p.symbol = ? AND a.tpsl_enabled = 1`, [symbol], (err, positions) => {
        if (err || !positions) return;

        positions.forEach(pos => {
            let priceMovePct = 0;
            if (pos.side === 'LONG') {
                priceMovePct = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
            } else {
                priceMovePct = ((pos.entry_price - currentPrice) / pos.entry_price) * 100;
            }
            const roe = priceMovePct * pos.leverage;

            if (pos.tpsl_enabled) {
                if (roe >= pos.tp_roi || roe <= pos.sl_roi) {
                    console.log(`[TPSL] Triggered for user ${pos.user_id} - ROE: ${roe.toFixed(2)}%`);
                    closePosition(pos.user_id, currentPrice);
                }
            }
            // Auto liquidation check (-100%)
            if (roe <= -100) {
                console.log(`[LIQN] Triggered for user ${pos.user_id}`);
                closePosition(pos.user_id, currentPrice);
            }
        });
    });
}

server.listen(PORT, () => {
    console.log(`Backend Server running on port ${PORT}`);
});
