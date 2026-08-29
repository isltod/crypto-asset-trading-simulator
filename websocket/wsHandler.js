const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middlewares/authMiddleware');

const connectedClients = new Map();
const userSockets = new Map();

function setupWebSocketServer(wss) {
    wss.on('connection', (ws, req) => {
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
                // Invalid token
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

        ws.send(JSON.stringify({ type: 'hb', time: Date.now() }));
    });

    // Heartbeat ping/pong every 30s
    setInterval(() => {
        wss.clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'hb', time: Date.now() }));
            }
        });
    }, 30000);
}

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

module.exports = {
    setupWebSocketServer,
    notifyUser
};
