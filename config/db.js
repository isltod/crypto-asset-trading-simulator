const sqlite3 = require('sqlite3').verbose();

const INITIAL_CAPITAL = 100;

// Database connection
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
        wt_ignore_obos INTEGER NOT NULL DEFAULT 0,
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

    // Dynamic schema updates (alter tables if missing)
    db.run(`ALTER TABLE trade_history ADD COLUMN leverage INTEGER DEFAULT 1`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN auto_trade_enabled BOOLEAN NOT NULL DEFAULT 0`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN signal_type TEXT NOT NULL DEFAULT 'none'`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_n1 INTEGER NOT NULL DEFAULT 10`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_n2 INTEGER NOT NULL DEFAULT 21`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_sig INTEGER NOT NULL DEFAULT 4`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_ob INTEGER NOT NULL DEFAULT 53`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN symbol TEXT NOT NULL DEFAULT 'BTCUSDT'`, () => {});
    db.run(`ALTER TABLE positions ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'MANUAL'`, () => {});
    db.run(`ALTER TABLE trade_history ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'MANUAL'`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_tf TEXT DEFAULT '5m'`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_fast INTEGER DEFAULT 12`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_slow INTEGER DEFAULT 26`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_sig INTEGER DEFAULT 9`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN macd_allow_repaint INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_tf TEXT DEFAULT '5m'`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_rsi_len INTEGER DEFAULT 14`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_len INTEGER DEFAULT 14`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_k INTEGER DEFAULT 3`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_d INTEGER DEFAULT 3`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN stoch_allow_repaint INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_tf TEXT DEFAULT '5m'`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_allow_repaint INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE accounts ADD COLUMN wt_ignore_obos INTEGER DEFAULT 0`, () => {});
});

module.exports = { db, INITIAL_CAPITAL };
