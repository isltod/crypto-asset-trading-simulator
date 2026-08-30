const express = require('express');
const { db, INITIAL_CAPITAL } = require('../config/db');
const { authenticateToken } = require('../middlewares/authMiddleware');

const router = express.Router();

// Get account details & active position
router.get('/', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    db.get(`SELECT * FROM accounts WHERE user_id = ?`, [userId], (err, account) => {
        if (err || !account) return res.status(500).json({ error: "Account not found" });
        db.get(`SELECT * FROM positions WHERE user_id = ? LIMIT 1`, [userId], (err, position) => {
            res.json({ account, activePosition: position || null });
        });
    });
});

// Recharge virtual capital
router.post('/recharge', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const newCapital = parseFloat(req.body.virtual_capital) || INITIAL_CAPITAL;
    if (newCapital < 0) return res.status(400).json({ error: "Invalid capital amount" });
    
    db.run(`UPDATE accounts SET virtual_capital = ? WHERE user_id = ?`, [newCapital, userId], function(err) {
        if (err) return res.status(500).json({ error: "Failed to set capital" });
        res.json({ message: "Capital updated successfully", virtual_capital: newCapital });
    });
});

// Update account configuration
router.post('/config', authenticateToken, (req, res) => {
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
        wt_ignore_obos,
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
        stoch_allow_repaint,
        v_tf,
        v_vwap_window,
        v_vwap_sigma,
        v_vol_lookback,
        v_vol_mult,
        v_wick_ratio,
        v_allow_repaint
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
        const updatedWtIgnoreObos = wt_ignore_obos !== undefined ? (wt_ignore_obos ? 1 : 0) : row.wt_ignore_obos;
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
        const updatedVTf = v_tf !== undefined ? v_tf : (row.v_tf || '15m');
        const updatedVVwapWindow = v_vwap_window !== undefined ? v_vwap_window : (row.v_vwap_window || 96);
        const updatedVVwapSigma = v_vwap_sigma !== undefined ? v_vwap_sigma : (row.v_vwap_sigma !== undefined ? row.v_vwap_sigma : 2.0);
        const updatedVVolLookback = v_vol_lookback !== undefined ? v_vol_lookback : (row.v_vol_lookback || 30);
        const updatedVVolMult = v_vol_mult !== undefined ? v_vol_mult : (row.v_vol_mult !== undefined ? row.v_vol_mult : 1.8);
        const updatedVWickRatio = v_wick_ratio !== undefined ? v_wick_ratio : (row.v_wick_ratio !== undefined ? row.v_wick_ratio : 0.8);
        const updatedVAllowRepaint = v_allow_repaint !== undefined ? (v_allow_repaint ? 1 : 0) : (row.v_allow_repaint || 0);

        db.run(`UPDATE accounts SET 
            leverage = ?, tpsl_enabled = ?, tp_roi = ?, sl_roi = ?, 
            auto_trade_enabled = ?, signal_type = ?, 
            wt_tf = ?, wt_n1 = ?, wt_n2 = ?, wt_sig = ?, wt_ob = ?, wt_allow_repaint = ?, wt_ignore_obos = ?,
            symbol = ?, macd_tf = ?, macd_fast = ?, macd_slow = ?, macd_sig = ?, macd_allow_repaint = ?,
            stoch_tf = ?, stoch_rsi_len = ?, stoch_len = ?, stoch_k = ?, stoch_d = ?, stoch_allow_repaint = ?,
            v_tf = ?, v_vwap_window = ?, v_vwap_sigma = ?, v_vol_lookback = ?, v_vol_mult = ?, v_wick_ratio = ?, v_allow_repaint = ?
            WHERE user_id = ?`, 
            [
                updatedLeverage, updatedTpsl, updatedTp, updatedSl, 
                updatedAutoTrade, updatedSignalType, 
                updatedWtTf, updatedWtN1, updatedWtN2, updatedWtSig, updatedWtOb, updatedWtAllowRepaint, updatedWtIgnoreObos,
                updatedSymbol, updatedMacdTf, updatedMacdFast, updatedMacdSlow, updatedMacdSig, updatedMacdAllowRepaint,
                updatedStochTf, updatedStochRsiLen, updatedStochLen, updatedStochK, updatedStochD, updatedStochAllowRepaint,
                updatedVTf, updatedVVwapWindow, updatedVVwapSigma, updatedVVolLookback, updatedVVolMult, updatedVWickRatio, updatedVAllowRepaint,
                userId
            ], 
            (err) => {
                if (err) return res.status(500).json({ error: "Failed to update config: " + err.message });
                res.json({ message: "Config updated" });
        });
    });
});

module.exports = router;
