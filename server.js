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
    const { leverage, tpsl_enabled, tp_roi, sl_roi } = req.body;
    db.run(`UPDATE accounts SET leverage = ?, tpsl_enabled = ?, tp_roi = ?, sl_roi = ? WHERE user_id = ?`, 
        [leverage, tpsl_enabled ? 1 : 0, tp_roi, sl_roi, userId], 
        (err) => {
            if (err) return res.status(500).json({ error: "Failed to update config" });
            res.json({ message: "Config updated" });
    });
});

// In-memory latest prices for backend logic (TPSL processing)
const latestPrices = {};

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
                    db.run(`INSERT INTO positions (user_id, symbol, side, entry_price, size, margin, leverage, entry_fee, capital_before) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
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


function closePosition(userId, specificPrice, res = null) {
    db.get(`SELECT p.*, a.virtual_capital FROM positions p JOIN accounts a ON p.user_id = a.user_id WHERE p.user_id = ?`, [userId], (err, pos) => {
        if (err || !pos) {
            if (res) res.status(400).json({ error: "No open position" });
            return;
        }

        const closePrice = specificPrice || latestPrices[pos.symbol];
        if (!closePrice) {
            if (res) res.status(400).json({ error: "Price not available" });
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
            db.run(`INSERT INTO trade_history (user_id, symbol, side, entry_time, entry_price, exit_price, pnl, roe, fee, capital_before, capital_after, leverage)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, pos.symbol, pos.side, pos.entry_time, pos.entry_price, closePrice, pnl, roe, totalFee, pos.capital_before, newVirtualCapital, pos.leverage]);
            db.run(`DELETE FROM positions WHERE user_id = ?`, [userId], () => {
                const result = { pnl, roe, totalFee, newCapital: newVirtualCapital, closePrice };
                if (res) {
                    res.json({ message: "Position closed", ...result });
                } else {
                    // Send websocket notification if closed by backend TPSL
                    notifyUser(userId, { type: 'position_closed', data: result });
                }
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
        console.log("Raw Binance message:", data.toString());
        try {
            const raw = JSON.parse(data);
            const message = raw.data; // Combined streams wrap data in {stream, data}
            
            if (message && message.e === 'kline') {
                lastBinanceMessageTime = Date.now();
                const symbol = message.s;
                const currentPrice = parseFloat(message.k.c);
                latestPrices[symbol] = currentPrice;
                console.log(`[Binance] Received kline for ${symbol}. Price: ${currentPrice}. Broadcasting to ${wss.clients.size} clients.`);

                // Broadcast to all connected clients
                const broadcastData = JSON.stringify(message);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastData);
                    }
                });

                checkTPSL(symbol, currentPrice);
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
setupBinanceStream();

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
