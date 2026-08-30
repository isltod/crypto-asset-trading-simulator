// Global State Definition
export const state = {
    // Auth & Session
    authToken: localStorage.getItem('cats_token') || null,
    currentUsername: localStorage.getItem('cats_username') || null,
    isLoginMode: true,

    // Market & Data
    currentSymbol: 'BTCUSDT',
    lastClose: 0,
    klineData: [],
    mtfKlines: {},
    lastHB: Date.now(),
    ws: null,

    // Account & Tracking from Server
    virtualCapital: 0,
    leverage: 1,
    tpslEnabled: false,
    tpRoi: 10,
    slRoi: -5,
    autoTradeEnabled: false,
    signalType: 'none',
    activePosition: null,
    tradeHistory: [],

    // Indicator Parameters & Series Cache
    maPeriod: 20,
    BB_PERIOD: 20,
    BB_STD_DEV: 2,

    // WaveTrend
    WT_TF: '5m',
    WT_CHANNEL_LEN: 10,
    WT_AVG_LEN: 21,
    WT_SIG_LEN: 4,
    WT_OB_LEVEL: 53,
    WT_ALLOW_REPAINT: false,
    WT_IGNORE_OBOS: false,
    lastWtData: null,
    wtPriceLines: [],

    // Supertrend
    supertrendPeriod: 10,
    supertrendMultiplier: 3.0,
    supertrendSeriesList: [],

    // MACD
    MACD_TF: '5m',
    MACD_FAST: 12,
    MACD_SLOW: 26,
    MACD_SIG: 9,
    MACD_ALLOW_REPAINT: false,
    lastMacdData: null,

    // StochRSI
    STOCH_TF: '5m',
    STOCH_RSI_LEN: 14,
    STOCH_LEN: 14,
    STOCH_K: 3,
    STOCH_D: 3,
    STOCH_ALLOW_REPAINT: false,
    lastStochData: null,
    stochPriceLines: [],

    // V-Climax (VWAP Climax)
    V_TF: '15m',
    V_VWAP_WINDOW: 96,
    V_VWAP_SIGMA: 2.0,
    V_VOL_LOOKBACK: 30,
    V_VOL_MULT: 1.8,
    V_WICK_RATIO: 0.8,
    V_ALLOW_REPAINT: false,
    lastVwapData: null,

    // Chart Instances & Series References
    chart: null,
    candleSeries: null,
    maSeries: null,
    bbUpperSeries: null,
    bbLowerSeries: null,
    bbMiddleSeries: null,
    vwapSeries: null,
    vwapUpperSeries: null,
    vwapLowerSeries: null,
    markerUpperSeries: null,
    markerLowerSeries: null,

    wtChart: null,
    wt1Series: null,
    wt2Series: null,

    macdChart: null,
    macdLineSeries: null,
    macdSigSeries: null,
    macdHistSeries: null,

    stochRsiChart: null,
    stochRsiKSeries: null,
    stochRsiDSeries: null,

    volChart: null,
    volHistSeries: null,
    volMaSeries: null,
    volSurgeThreshSeries: null,

    activeChart: null
};
