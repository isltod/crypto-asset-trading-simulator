const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/authRoutes');
const accountRoutes = require('./routes/accountRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const proxyRoutes = require('./routes/proxyRoutes');

const { 
    SYMBOLS_TO_STREAM, 
    initKlineHistories, 
    updateKlineTick, 
    setBinanceStatus, 
    getBinanceState 
} = require('./services/marketService');
const { checkTPSL, setNotifyUserFunction } = require('./services/tradeService');
const { checkAutoTradeSignals } = require('./services/autoTradeService');
const { setupWebSocketServer, notifyUser } = require('./websocket/wsHandler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;
const BASE_PATH = '/cats';

// Middleware
app.use(express.json());
app.use(cors());
app.use(BASE_PATH, express.static(path.join(__dirname, '/')));
app.get('/', (req, res) => res.redirect(BASE_PATH + '/'));

// Routes
app.use(`${BASE_PATH}/api/auth`, authRoutes);
app.use(`${BASE_PATH}/api/account`, accountRoutes);
app.use(`${BASE_PATH}/api/trade`, tradeRoutes);
app.use(`${BASE_PATH}/api/history`, tradeRoutes);
app.use(`${BASE_PATH}/api/proxy`, proxyRoutes);

// Health/Status endpoint
app.get(`${BASE_PATH}/api/status`, (req, res) => {
    const uptime = process.uptime();
    const bState = getBinanceState();
    const timeSinceLastMessage = bState.lastMessageTime ? (Date.now() - bState.lastMessageTime) / 1000 : null;
    
    res.json({
        status: "ok",
        uptime,
        binance: {
            status: bState.status,
            lastMessageSecondsAgo: timeSinceLastMessage,
            error: bState.error
        },
        clientsConnected: wss.clients.size
    });
});

// Setup WebSocket Server & Handler
setupWebSocketServer(wss);
setNotifyUserFunction(notifyUser);

// Connect to Binance Futures Stream
let binanceWs = null;

function setupBinanceStream() {
    console.log("Connecting to Binance WebSocket...");
    setBinanceStatus("connecting");
    
    const streams = SYMBOLS_TO_STREAM.map(s => `${s}@kline_1m`).join('/');
    const endpoint = `wss://fstream.binance.com/market/stream?streams=${streams}`;
    
    binanceWs = new WebSocket(endpoint);
    
    binanceWs.on('open', () => {
        console.log("Connected to Binance Futures WebSocket.");
        setBinanceStatus("connected", null);
    });

    binanceWs.on('message', (data) => {
        try {
            const raw = JSON.parse(data);
            const message = raw.data;
            
            if (message && message.e === 'kline') {
                const symbol = message.s;
                const currentPrice = updateKlineTick(symbol, message);

                const broadcastData = JSON.stringify(message);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastData);
                    }
                });

                checkTPSL(symbol, currentPrice);
                checkAutoTradeSignals(symbol, currentPrice, message.k.x === true);
            }
        } catch (e) {
            console.error("Error parsing Binance message:", e);
        }
    });
    
    binanceWs.on('error', (err) => {
        console.error("Binance WS Error:", err.message);
        setBinanceStatus("error", err.message);
    });

    binanceWs.on('close', () => {
        console.log("Binance WS closed. Reconnecting in 5s...");
        setBinanceStatus("disconnected", null);
        setTimeout(setupBinanceStream, 5000);
    });
}

initKlineHistories().then(() => {
    setupBinanceStream();
}).catch(err => {
    console.error("Failed to initialize kline histories, starting stream anyway:", err);
    setupBinanceStream();
});

server.listen(PORT, () => {
    console.log(`Backend Server running on port ${PORT}`);
});
