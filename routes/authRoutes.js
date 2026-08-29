const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db, INITIAL_CAPITAL } = require('../config/db');
const { JWT_SECRET } = require('../middlewares/authMiddleware');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
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

// Login
router.post('/login', (req, res) => {
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

module.exports = router;
