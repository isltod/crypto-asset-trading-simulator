const express = require('express');
const { db } = require('../config/db');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { latestPrices } = require('../services/marketService');
const { closePosition } = require('../services/tradeService');

const router = express.Router();

// Manual open position
router.post('/open', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const { side, symbol, currentPrice } = req.body;

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

// Manual close position
router.post('/close', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const { currentPrice } = req.body;
    closePosition(userId, currentPrice, res);
});

// Trade history list
router.get('/history', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    db.all(`SELECT * FROM trade_history WHERE user_id = ? ORDER BY exit_time DESC`, [userId], (err, rows) => {
        res.json(rows || []);
    });
});

// Clear trade history
router.delete('/history', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    db.run(`DELETE FROM trade_history WHERE user_id = ?`, [userId], (err) => {
        res.json({ message: "History cleared" });
    });
});

module.exports = router;
