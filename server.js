const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

let ort;
try {
    ort = require('onnxruntime-node');
    console.log("[ONNX] onnxruntime-node module loaded successfully.");
} catch (e) {
    console.log("[ONNX] onnxruntime-node is not installed. RL auto-trading signals will be disabled. Run 'npm install onnxruntime-node' to enable it.");
}

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
        wt_tf TEXT NOT NULL DEFAULT '5m',
        wt_n1 INTEGER NOT NULL DEFAULT 10,
        wt_n2 INTEGER NOT NULL DEFAULT 21,
        wt_sig INTEGER NOT NULL DEFAULT 4,
        wt_ob INTEGER NOT NULL DEFAULT 53,
        wt_allow_repaint INTEGER NOT NULL DEFAULT 0,
        symbol TEXT NOT NULL DEFAULT 'BTCUSDT',
        macd_tf TEXT NOT NULL DEFAULT '5m',
        macd_fast INTEGER NOT NULL DEFAULT 12,
        macd_slow INTEGER NOT NULL DEFAULT 26,
        macd_sig INTEGER NOT NULL DEFAULT 9,
        macd_allow_repaint INTEGER NOT NULL DEFAULT 0,
        stoch_tf TEXT NOT NULL DEFAULT '5m',
        stoch_rsi_len INTEGER NOT NULL DEFAULT 14,
        stoch_len INTEGER NOT NULL DEFAULT 14,
        stoch_k INTEGER NOT NULL DEFAULT 3,
        stoch_d INTEGER NOT NULL DEFAULT 3,
        stoch_allow_repaint INTEGER NOT NULL DEFAULT 0,
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
    db.run(`ALTER TABLE accounts ADD COLUMN macd_tf TEXT DEFAULT '5m'`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_fast INTEGER DEFAULT 12`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_slow INTEGER DEFAULT 26`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_sig INTEGER DEFAULT 9`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_allow_repaint INTEGER DEFAULT 0`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_tf TEXT DEFAULT '5m'`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_rsi_len INTEGER DEFAULT 14`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_len INTEGER DEFAULT 14`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_k INTEGER DEFAULT 3`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_d INTEGER DEFAULT 3`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_allow_repaint INTEGER DEFAULT 0`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_tf TEXT DEFAULT '5m'`, (err) => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_allow_repaint INTEGER DEFAULT 0`, (err) => {});
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
        wt_tf,
        wt_n1, 
        wt_n2, 
        wt_sig, 
        wt_ob,
        wt_allow_repaint,
        symbol,
        macd_tf,
        macd_fast,
        macd_slow,
        macd_sig,
        macd_allow_repaint,
        stoch_tf,
        stoch_rsi_len,
        stoch_len,
        stoch_k,
        stoch_d,
        stoch_allow_repaint
    } = req.body;

    db.get(`SELECT * FROM accounts WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) return res.status(500).json({ error: "Account not found" });

        const updatedLeverage = leverage !== undefined ? leverage : row.leverage;
        const updatedTpsl = tpsl_enabled !== undefined ? (tpsl_enabled ? 1 : 0) : row.tpsl_enabled;
        const updatedTp = tp_roi !== undefined ? tp_roi : row.tp_roi;
        const updatedSl = sl_roi !== undefined ? sl_roi : row.sl_roi;
        const updatedAutoTrade = auto_trade_enabled !== undefined ? (auto_trade_enabled ? 1 : 0) : row.auto_trade_enabled;
        const updatedSignalType = signal_type !== undefined ? signal_type : row.signal_type;
        const updatedWtTf = wt_tf !== undefined ? wt_tf : row.wt_tf;
        const updatedWtN1 = wt_n1 !== undefined ? wt_n1 : row.wt_n1;
        const updatedWtN2 = wt_n2 !== undefined ? wt_n2 : row.wt_n2;
        const updatedWtSig = wt_sig !== undefined ? wt_sig : row.wt_sig;
        const updatedWtOb = wt_ob !== undefined ? wt_ob : row.wt_ob;
        const updatedWtAllowRepaint = wt_allow_repaint !== undefined ? (wt_allow_repaint ? 1 : 0) : row.wt_allow_repaint;
        const updatedSymbol = symbol !== undefined ? symbol : row.symbol;
        const updatedMacdTf = macd_tf !== undefined ? macd_tf : row.macd_tf;
        const updatedMacdFast = macd_fast !== undefined ? macd_fast : row.macd_fast;
        const updatedMacdSlow = macd_slow !== undefined ? macd_slow : row.macd_slow;
        const updatedMacdSig = macd_sig !== undefined ? macd_sig : row.macd_sig;
        const updatedMacdAllowRepaint = macd_allow_repaint !== undefined ? (macd_allow_repaint ? 1 : 0) : row.macd_allow_repaint;
        const updatedStochTf = stoch_tf !== undefined ? stoch_tf : row.stoch_tf;
        const updatedStochRsiLen = stoch_rsi_len !== undefined ? stoch_rsi_len : row.stoch_rsi_len;
        const updatedStochLen = stoch_len !== undefined ? stoch_len : row.stoch_len;
        const updatedStochK = stoch_k !== undefined ? stoch_k : row.stoch_k;
        const updatedStochD = stoch_d !== undefined ? stoch_d : row.stoch_d;
        const updatedStochAllowRepaint = stoch_allow_repaint !== undefined ? (stoch_allow_repaint ? 1 : 0) : row.stoch_allow_repaint;

        db.run(`UPDATE accounts SET 
            leverage = ?, tpsl_enabled = ?, tp_roi = ?, sl_roi = ?, 
            auto_trade_enabled = ?, signal_type = ?, 
            wt_tf = ?, wt_n1 = ?, wt_n2 = ?, wt_sig = ?, wt_ob = ?, wt_allow_repaint = ?,
            symbol = ?, macd_tf = ?, macd_fast = ?, macd_slow = ?, macd_sig = ?, macd_allow_repaint = ?,
            stoch_tf = ?, stoch_rsi_len = ?, stoch_len = ?, stoch_k = ?, stoch_d = ?, stoch_allow_repaint = ?
            WHERE user_id = ?`, 
            [
                updatedLeverage, updatedTpsl, updatedTp, updatedSl, 
                updatedAutoTrade, updatedSignalType, 
                updatedWtTf, updatedWtN1, updatedWtN2, updatedWtSig, updatedWtOb, updatedWtAllowRepaint, 
                updatedSymbol, updatedMacdTf, updatedMacdFast, updatedMacdSlow, updatedMacdSig, updatedMacdAllowRepaint,
                updatedStochTf, updatedStochRsiLen, updatedStochLen, updatedStochK, updatedStochD, updatedStochAllowRepaint,
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

// Binance Proxy Endpoints for Frontend
app.get(`${BASE_PATH}/api/proxy/exchangeInfo`, async (req, res) => {
    const url = `https://fapi.binance.com/fapi/v1/exchangeInfo`;
    try {
        const data = await getJson(url);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get(`${BASE_PATH}/api/proxy/klines`, async (req, res) => {
    const symbol = req.query.symbol || 'BTCUSDT';
    const interval = req.query.interval || '1m';
    const limit = req.query.limit || 1000;
    let url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (req.query.endTime) {
        url += `&endTime=${req.query.endTime}`;
    }
    if (req.query.startTime) {
        url += `&startTime=${req.query.startTime}`;
    }
    try {
        const data = await getJson(url);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
const klineHistoriesMTF = {};

async function initKlineHistories() {
    for (const rawSymbol of SYMBOLS_TO_STREAM) {
        const symbol = rawSymbol.toUpperCase();
        klineHistoriesMTF[symbol] = {};

        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=1000`;
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

        const mtfList = ['3m', '5m', '15m', '30m', '1h', '4h', '1d'];
        for (const tf of mtfList) {
            const mtfUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${tf}&limit=1000`;
            try {
                const data = await getJson(mtfUrl);
                klineHistoriesMTF[symbol][tf] = data.map(d => ({
                    time: Math.floor(d[0] / 1000),
                    open: parseFloat(d[1]),
                    high: parseFloat(d[2]),
                    low: parseFloat(d[3]),
                    close: parseFloat(d[4])
                }));
            } catch (e) {
                console.error(`[Init] Failed to load ${tf} klines for ${symbol}:`, e.message);
                klineHistoriesMTF[symbol][tf] = [];
            }
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

function aggregateKlines(history, timeframe, symbol = null) {
    const tfMap = {
        '1m': 60,
        '3m': 180,
        '5m': 300,
        '15m': 900,
        '30m': 1800,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
    };
    const interval = tfMap[timeframe] || 60;
    const grouped = {};
    for (const tick of history) {
        const key = Math.floor(tick.time / interval) * interval;
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(tick);
    }
    const aggregated = [];
    const keys = Object.keys(grouped).map(Number).sort((a, b) => a - b);
    for (const key of keys) {
        const group = grouped[key];
        const open = group[0].open;
        const close = group[group.length - 1].close;
        let high = -Infinity;
        let low = Infinity;
        for (const tick of group) {
            if (tick.high > high) high = tick.high;
            if (tick.low < low) low = tick.low;
        }
        aggregated.push({
            time: key,
            open,
            high,
            low,
            close
        });
    }

    if (symbol && timeframe !== '1m' && typeof klineHistoriesMTF !== 'undefined' && klineHistoriesMTF[symbol] && klineHistoriesMTF[symbol][timeframe]) {
        const mtfHistory = klineHistoriesMTF[symbol][timeframe];
        const firstAggTime = aggregated.length > 0 ? aggregated[0].time : Infinity;
        const merged = mtfHistory.filter(k => k.time < firstAggTime);
        return merged.concat(aggregated);
    }

    return aggregated;
}

function calculateMACDForKlines(klines, fast, slow, sig) {
    const closes = klines.map(k => k.close);
    const len = closes.length;
    const macdLine = new Array(len).fill(0);
    const signalLine = new Array(len).fill(0);
    const hist = new Array(len).fill(0);
    if (len < slow + sig) {
        return { macdLine, signalLine, hist };
    }
    const emaFast = calculateEMA(closes, fast);
    const emaSlow = calculateEMA(closes, slow);
    for (let i = 0; i < len; i++) {
        macdLine[i] = emaFast[i] - emaSlow[i];
    }
    const macdSlice = macdLine.slice(slow - 1);
    const emaSigSlice = calculateEMA(macdSlice, sig);
    for (let i = 0; i < len; i++) {
        if (i < slow - 1) {
            signalLine[i] = 0;
            hist[i] = 0;
        } else {
            signalLine[i] = emaSigSlice[i - (slow - 1)];
            hist[i] = macdLine[i] - signalLine[i];
        }
    }
    return { macdLine, signalLine, hist };
}

function calculateRSI(closes, period = 14) {
    const len = closes.length;
    const rsi = new Array(len).fill(null);
    if (len < 2) return rsi;
    
    const alpha = 1 / period;
    let avgGain = closes[1] - closes[0] > 0 ? closes[1] - closes[0] : 0;
    let avgLoss = closes[1] - closes[0] < 0 ? Math.abs(closes[1] - closes[0]) : 0;
    
    rsi[1] = avgLoss === 0 ? 100 : (avgGain === 0 ? 0 : 100 - (100 / (1 + avgGain / avgLoss)));
    
    for (let i = 2; i < len; i++) {
        const change = closes[i] - closes[i - 1];
        let gain = 0;
        let loss = 0;
        if (change > 0) gain = change;
        else loss = Math.abs(change);
        
        avgGain = avgGain * (1 - alpha) + gain * alpha;
        avgLoss = avgLoss * (1 - alpha) + loss * alpha;
        
        if (avgLoss === 0) {
            rsi[i] = 100;
        } else if (avgGain === 0) {
            rsi[i] = 0;
        } else {
            const rs = avgGain / avgLoss;
            rsi[i] = 100 - (100 / (1 + rs));
        }
    }
    return rsi;
}

function calculateStochRSI(klines, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
    const closes = klines.map(k => k.close);
    const rsi = calculateRSI(closes, rsiPeriod);
    const len = closes.length;
    const stochRsiRaw = new Array(len).fill(null);
    
    for (let i = 0; i < len; i++) {
        if (i < rsiPeriod + stochPeriod - 1) continue;
        
        let lowestRSI = rsi[i];
        let highestRSI = rsi[i];
        let valid = true;
        for (let j = i - stochPeriod + 1; j <= i; j++) {
            if (rsi[j] === null) {
                valid = false;
                break;
            }
            if (rsi[j] < lowestRSI) lowestRSI = rsi[j];
            if (rsi[j] > highestRSI) highestRSI = rsi[j];
        }
        
        if (!valid) continue;
        
        if (highestRSI === lowestRSI) {
            stochRsiRaw[i] = 0;
        } else {
            stochRsiRaw[i] = 100 * (rsi[i] - lowestRSI) / (highestRSI - lowestRSI);
        }
    }
    
    const kLine = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
        if (i < rsiPeriod + stochPeriod - 1 + kPeriod - 1) continue;
        let sum = 0;
        let valid = true;
        for (let j = i - kPeriod + 1; j <= i; j++) {
            if (stochRsiRaw[j] === null) {
                valid = false;
                break;
            }
            sum += stochRsiRaw[j];
        }
        if (valid) {
            kLine[i] = sum / kPeriod;
        }
    }
    
    const dLine = new Array(len).fill(null);
    for (let i = 0; i < len; i++) {
        if (i < rsiPeriod + stochPeriod - 1 + kPeriod - 1 + dPeriod - 1) continue;
        let sum = 0;
        let valid = true;
        for (let j = i - dPeriod + 1; j <= i; j++) {
            if (kLine[j] === null) {
                valid = false;
                break;
            }
            sum += kLine[j];
        }
        if (valid) {
            dLine[i] = sum / dPeriod;
        }
    }
    
    return { kLine, dLine };
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

let rlModelSession = null;
let rlModelConfig = null;

async function loadRLModel() {
    if (!ort) return;
    const onnxPath = path.join(__dirname, 'public_models', 'btc_1m.onnx');
    const configPath = path.join(__dirname, 'public_models', 'btc_1m_config.json');
    
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

// Watch public_models directory for changes to reload model
if (ort) {
    const modelsDir = path.join(__dirname, 'public_models');
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
    
    // Log returns (r)
    const r = [];
    for (let i = 1; i < closes.length; i++) {
        r.push(Math.log(closes[i] / closes[i - 1]));
    }
    
    const featureMatrix = [];
    const startIdx = closes.length - lags;
    for (let idx = startIdx; idx < closes.length; idx++) {
        const closeVal = closes[idx];
        
        // rolling mean of close (s) ending at idx
        let sumClose = 0;
        for (let i = 0; i < window; i++) {
            sumClose += closes[idx - i];
        }
        const sVal = sumClose / window;
        
        const rIdx = idx - 1;
        const rVal = r[rIdx];
        
        // rolling mean of r (m) ending at rIdx
        let sumR = 0;
        for (let i = 0; i < window; i++) {
            sumR += r[rIdx - i];
        }
        const mVal = sumR / window;
        
        // rolling std of r (v) ending at rIdx (ddof=1)
        let sumRSq = 0;
        for (let i = 0; i < window; i++) {
            sumRSq += Math.pow(r[rIdx - i] - mVal, 2);
        }
        const vVal = Math.sqrt(sumRSq / (window - 1));
        
        // Normalize
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
        const output = results.output.data; // shape: [1, lags, output_dim] -> [1, 3, 2] -> 6 elements
        
        // Prediction at [0, 0] is output[0] and output[1]
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

    db.all(`SELECT a.*, u.username FROM accounts a JOIN users u ON a.user_id = u.id WHERE a.auto_trade_enabled = 1 AND a.signal_type IN ('wave_trend', 'rl_model', 'mtf_macd', 'stoch_rsi')`, (err, accounts) => {
        if (err || !accounts || accounts.length === 0) return;

        accounts.forEach(async (account) => {
            // Only process signals for the symbol that the user has configured
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

                if (!isClosed && !allowRepaint) return; // 리페인팅 미허용 시 미마감 캔들 무시

                const aggregated = aggregateKlines(history, tf, symbol);
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
                            if (prevWt1 < prevWt2 && currWt1 > currWt2 && currWt1 < -obLevel) {
                                signal = 'LONG';
                            } else if (prevWt1 > prevWt2 && currWt1 < currWt2 && currWt1 > obLevel) {
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

                if (!isClosed && !allowRepaint) return; // 리페인팅 미허용 시 미마감 캔들 무시

                const aggregated = aggregateKlines(history, tf, symbol);
                const macdResult = calculateMACDForKlines(aggregated, fast, slow, sig);
                
                const currentTick = history[history.length - 1];
                if (currentTick) {
                    const tfMap = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
                    const duration = tfMap[tf] || 300;

                    // The 1m candle just closed. Its end time is currentTick.time + 60
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

                if (!isClosed && !allowRepaint) return; // ignore uncompleted candles if repaint is not allowed

                const aggregated = aggregateKlines(history, tf, symbol);
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
                            
                            // Golden cross in oversold area (<= 20)
                            if (prevK <= prevD && currK > currD && (currK <= 20 || prevK <= 20)) {
                                signal = 'LONG';
                            }
                            // Dead cross in overbought area (>= 80)
                            else if (prevK >= prevD && currK < currD && (currK >= 80 || prevK >= 80)) {
                                signal = 'SHORT';
                            }
                        }
                    }
                }
            } else if (account.signal_type === 'rl_model') {
                if (!isClosed) return; // RL Model only on closed candles
                signal = await getRLSignal(symbol);
            }

            if (signal && signal !== 'HOLD') {
                console.log(`[AutoTrade] Signal ${signal} detected via ${account.signal_type} for user ${account.username} (${userId}) on ${symbol}. Price: ${currentPrice}`);
                db.get(`SELECT * FROM positions WHERE user_id = ?`, [userId], (err, pos) => {
                    if (err) return;
                    
                    if (pos) {
                        // Check if the open position's symbol matches the signal symbol.
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
    const endpoint = `wss://fstream.binance.com/market/stream?streams=${streams}`;
    
    binanceWs = new WebSocket(endpoint);
    
    binanceWs.on('open', () => {
        console.log("Connected to Binance Futures WebSocket.");
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

                    // 다중 타임프레임(MTF) 데이터도 실시간으로 업데이트하여 갭 방지
                    if (klineHistoriesMTF[symbol]) {
                        const tfMap = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400 };
                        for (const tf in klineHistoriesMTF[symbol]) {
                            const interval = tfMap[tf];
                            if (!interval) continue;
                            const mtfHistory = klineHistoriesMTF[symbol][tf];
                            const key = Math.floor(tick.time / interval) * interval;
                            const mtfLastIdx = mtfHistory.length - 1;
                            
                            if (mtfLastIdx >= 0 && mtfHistory[mtfLastIdx].time === key) {
                                const currentMtf = mtfHistory[mtfLastIdx];
                                currentMtf.high = Math.max(currentMtf.high, tick.high);
                                currentMtf.low = Math.min(currentMtf.low, tick.low);
                                currentMtf.close = tick.close;
                            } else {
                                mtfHistory.push({
                                    time: key,
                                    open: tick.open,
                                    high: tick.high,
                                    low: tick.low,
                                    close: tick.close
                                });
                                if (mtfHistory.length > 500) {
                                    mtfHistory.shift();
                                }
                            }
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

                // 자동거래 신호 분석 (리페인팅 설정 적용을 위해 매 틱마다 호출)
                checkAutoTradeSignals(symbol, currentPrice, message.k.x === true);
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
