const express = require('express');
const { getJson, klineHistories } = require('../services/marketService');

const router = express.Router();

// Binance Proxy Endpoints for Frontend
router.get('/exchangeInfo', async (req, res) => {
    const url = `https://fapi.binance.com/fapi/v1/exchangeInfo`;
    try {
        const data = await getJson(url);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/klines', async (req, res) => {
    const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
    const interval = req.query.interval || '1m';

    // If 1m klines requested and backend already has history, serve directly from backend memory
    if (interval === '1m' && klineHistories[symbol] && klineHistories[symbol].length > 0) {
        const rawFormat = klineHistories[symbol].map(k => [
            k.time * 1000,
            k.open.toString(),
            k.high.toString(),
            k.low.toString(),
            k.close.toString(),
            "0",
            k.time * 1000 + 59999,
            "0", 0, "0", "0", "0"
        ]);
        return res.json(rawFormat);
    }

    // Fallback to proxying external Binance endpoint if not in memory
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

module.exports = router;
