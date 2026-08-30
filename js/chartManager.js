import { state } from './state.js';
import { 
    calculateMTFWaveTrend, 
    calculateMTFMacd, 
    calculateMTFStochRSI, 
    calculateSupertrend,
    calculateMTFVWAPClimax
} from './indicators.js';

export function updateWTPriceLines() {
    state.wtPriceLines.forEach(line => {
        try {
            state.wt1Series.removePriceLine(line);
        } catch (e) { }
    });
    state.wtPriceLines = [];

    if (!state.wt1Series) return;

    const obLine = state.wt1Series.createPriceLine({
        price: state.WT_OB_LEVEL,
        color: 'rgba(250, 204, 21, 0.8)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Overbought (${state.WT_OB_LEVEL})`,
    });
    const zeroLine = state.wt1Series.createPriceLine({
        price: 0,
        color: 'rgba(255, 255, 255, 0.3)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: false,
    });
    const osLine = state.wt1Series.createPriceLine({
        price: -state.WT_OB_LEVEL,
        color: 'rgba(250, 204, 21, 0.8)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Oversold (-${state.WT_OB_LEVEL})`,
    });

    state.wtPriceLines.push(obLine, zeroLine, osLine);
}

export function updateStochPriceLines() {
    state.stochPriceLines.forEach(line => {
        try {
            state.stochRsiKSeries.removePriceLine(line);
        } catch (e) { }
    });
    state.stochPriceLines = [];

    if (!state.stochRsiKSeries) return;

    const obLine = state.stochRsiKSeries.createPriceLine({
        price: 80,
        color: 'rgba(239, 68, 68, 0.6)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Overbought (80)',
    });
    const osLine = state.stochRsiKSeries.createPriceLine({
        price: 20,
        color: 'rgba(34, 197, 94, 0.6)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Oversold (20)',
    });

    state.stochPriceLines.push(obLine, osLine);
}

export function applyIndicatorMarkers() {
    const toggleWT = document.getElementById('toggle-wt');
    const toggleMACD = document.getElementById('toggle-macd');
    if (!state.candleSeries) return;

    const formattedData = state.klineData;
    if (!formattedData || formattedData.length === 0) return;

    const markers = [];
    const len = formattedData.length;

    // 1. WaveTrend Markers
    if (toggleWT && toggleWT.checked && state.lastWtData && state.lastWtData.wt1Data && state.lastWtData.wt2Data) {
        const wtData = state.lastWtData;
        const wtMarkers = [];
        for (let i = 1; i < len; i++) {
            const prevWt1 = wtData.wt1Data[i - 1].value;
            const prevWt2 = wtData.wt2Data[i - 1].value;
            const currWt1 = wtData.wt1Data[i].value;
            const currWt2 = wtData.wt2Data[i].value;

            if (prevWt1 === undefined || prevWt2 === undefined || currWt1 === undefined || currWt2 === undefined) {
                continue;
            }

            const time = formattedData[i].time;

            if (prevWt1 < prevWt2 && currWt1 > currWt2 && (state.WT_IGNORE_OBOS || currWt1 < -state.WT_OB_LEVEL)) {
                markers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#2ebd85',
                    shape: 'arrowUp',
                    text: 'LONG',
                    size: 1
                });
                wtMarkers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#2ebd85',
                    shape: 'circle',
                    text: 'L',
                    size: 1
                });
            } else if (prevWt1 > prevWt2 && currWt1 < currWt2 && (state.WT_IGNORE_OBOS || currWt1 > state.WT_OB_LEVEL)) {
                markers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#f6465d',
                    shape: 'arrowDown',
                    text: 'SHORT',
                    size: 1
                });
                wtMarkers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#f6465d',
                    shape: 'circle',
                    text: 'S',
                    size: 1
                });
            }
        }
        if (state.wt1Series) state.wt1Series.setMarkers(wtMarkers);
    } else {
        if (state.wt1Series) state.wt1Series.setMarkers([]);
    }

    // 2. MACD Markers
    if (toggleMACD && toggleMACD.checked && state.lastMacdData && state.lastMacdData.macdData && state.lastMacdData.sigData) {
        const macdData = state.lastMacdData;
        const macdMarkers = [];
        for (let i = 1; i < len; i++) {
            const prevM = macdData.macdData[i - 1].value;
            const prevS = macdData.sigData[i - 1].value;
            const currM = macdData.macdData[i].value;
            const currS = macdData.sigData[i].value;

            if (prevM === undefined || prevS === undefined || currM === undefined || currS === undefined) {
                continue;
            }

            const time = formattedData[i].time;

            if (prevM < prevS && currM > currS) {
                markers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#38bdf8',
                    shape: 'arrowUp',
                    text: 'MACD LONG',
                    size: 1
                });
                macdMarkers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#38bdf8',
                    shape: 'circle',
                    text: 'L',
                    size: 1
                });
            } else if (prevM > prevS && currM < currS) {
                markers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#fb923c',
                    shape: 'arrowDown',
                    text: 'MACD SHORT',
                    size: 1
                });
                macdMarkers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#fb923c',
                    shape: 'circle',
                    text: 'S',
                    size: 1
                });
            }
        }
        if (state.macdLineSeries) state.macdLineSeries.setMarkers(macdMarkers);
    } else {
        if (state.macdLineSeries) state.macdLineSeries.setMarkers([]);
    }

    // 3. StochRSI Markers
    const toggleStoch = document.getElementById('toggle-stoch-rsi');
    if (toggleStoch && toggleStoch.checked && state.lastStochData && state.lastStochData.kData && state.lastStochData.dData) {
        const stochData = state.lastStochData;
        const stochMarkers = [];
        for (let i = 1; i < len; i++) {
            const prevK = stochData.kData[i - 1].value;
            const prevD = stochData.dData[i - 1].value;
            const currK = stochData.kData[i].value;
            const currD = stochData.dData[i].value;

            if (prevK === undefined || prevD === undefined || currK === undefined || currD === undefined ||
                prevK === null || prevD === null || currK === null || currD === null) {
                continue;
            }

            const time = formattedData[i].time;

            if (prevK <= prevD && currK > currD && (currK <= 20 || prevK <= 20)) {
                markers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#22c55e',
                    shape: 'arrowUp',
                    text: 'STOCH LONG',
                    size: 1
                });
                stochMarkers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#22c55e',
                    shape: 'circle',
                    text: 'L',
                    size: 1
                });
            } else if (prevK >= prevD && currK < currD && (currK >= 80 || prevK >= 80)) {
                markers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#ef4444',
                    shape: 'arrowDown',
                    text: 'STOCH SHORT',
                    size: 1
                });
                stochMarkers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#ef4444',
                    shape: 'circle',
                    text: 'S',
                    size: 1
                });
            }
        }
        if (state.stochRsiKSeries) state.stochRsiKSeries.setMarkers(stochMarkers);
    } else {
        if (state.stochRsiKSeries) state.stochRsiKSeries.setMarkers([]);
    }

    // 4. V-Climax (VWAP Climax) Markers & Sub-condition Markers
    const upperVwapMarkers = [];
    const lowerVwapMarkers = [];
    const toggleVWAP = document.getElementById('toggle-vwap');
    if (toggleVWAP && toggleVWAP.checked && state.lastVwapData) {
        const subMarkers = state.lastVwapData.subMarkers || [];
        for (let i = 0; i < subMarkers.length; i++) {
            const m = subMarkers[i];
            const time = m.time;

            if (m.signal === 1) {
                // 3 conditions ALL met -> Full Long Signal (Lower offset)
                lowerVwapMarkers.push({
                    time: time,
                    position: 'belowBar',
                    color: '#10b981',
                    shape: 'arrowUp',
                    text: 'LONG',
                    size: 1.5
                });
            } else if (m.signal === -1) {
                // 3 conditions ALL met -> Full Short Signal (Upper offset)
                upperVwapMarkers.push({
                    time: time,
                    position: 'aboveBar',
                    color: '#f43f5e',
                    shape: 'arrowDown',
                    text: 'SHORT',
                    size: 1.5
                });
            } else {
                // Individual condition sub-markers (Spaced via dedicated offset lines)
                if (m.isLowerWick) {
                    lowerVwapMarkers.push({
                        time: time,
                        position: 'belowBar',
                        color: '#38bdf8',
                        shape: 'circle',
                        size: 0.8
                    });
                } else if (m.isUpperWick) {
                    upperVwapMarkers.push({
                        time: time,
                        position: 'aboveBar',
                        color: '#ec4899',
                        shape: 'circle',
                        size: 0.8
                    });
                }
            }
        }
    }

    markers.sort((a, b) => a.time - b.time);
    state.candleSeries.setMarkers(markers);

    upperVwapMarkers.sort((a, b) => a.time - b.time);
    if (state.markerUpperSeries) state.markerUpperSeries.setMarkers(upperVwapMarkers);

    lowerVwapMarkers.sort((a, b) => a.time - b.time);
    if (state.markerLowerSeries) state.markerLowerSeries.setMarkers(lowerVwapMarkers);
}

export function renderSupertrend() {
    state.supertrendSeriesList.forEach(series => {
        try {
            state.chart.removeSeries(series);
        } catch (e) { }
    });
    state.supertrendSeriesList = [];

    const toggleSupertrend = document.getElementById('toggle-supertrend');
    const isVisible = toggleSupertrend ? toggleSupertrend.checked : false;
    if (!isVisible) return;

    const data = state.klineData;
    if (!data || data.length === 0) return;

    const results = calculateSupertrend(data, state.supertrendPeriod, state.supertrendMultiplier);
    if (results.length === 0) return;

    const segments = [];
    let currentSegment = null;

    for (let i = 0; i < results.length; i++) {
        const item = results[i];
        if (item.value === null) {
            if (currentSegment) {
                segments.push(currentSegment);
                currentSegment = null;
            }
            continue;
        }

        if (!currentSegment) {
            currentSegment = {
                trend: item.trend,
                data: [{ time: item.time, value: item.value }]
            };
        } else if (currentSegment.trend === item.trend) {
            currentSegment.data.push({ time: item.time, value: item.value });
        } else {
            segments.push(currentSegment);
            currentSegment = {
                trend: item.trend,
                data: [{ time: item.time, value: item.value }]
            };
        }
    }
    if (currentSegment) {
        segments.push(currentSegment);
    }

    segments.forEach(seg => {
        const series = state.chart.addLineSeries({
            color: seg.trend === 1 ? '#2ebd85' : '#f6465d',
            lineWidth: 2,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false
        });
        series.setData(seg.data);
        state.supertrendSeriesList.push(series);
    });
}

export function updateChartSeries() {
    const formattedData = state.klineData;
    if (!formattedData || formattedData.length === 0) return;

    state.candleSeries.setData(formattedData);

    const maData = [];
    for (let i = state.maPeriod - 1; i < formattedData.length; i++) {
        let sum = 0;
        for (let j = 0; j < state.maPeriod; j++) sum += formattedData[i - j].close;
        maData.push({ time: formattedData[i].time, value: sum / state.maPeriod });
    }
    state.maSeries.setData(maData);

    const bbUpperData = [], bbLowerData = [], bbMiddleData = [];
    for (let i = state.BB_PERIOD - 1; i < formattedData.length; i++) {
        let sum = 0;
        for (let j = 0; j < state.BB_PERIOD; j++) sum += formattedData[i - j].close;
        const sma = sum / state.BB_PERIOD;
        let varSum = 0;
        for (let j = 0; j < state.BB_PERIOD; j++) varSum += Math.pow(formattedData[i - j].close - sma, 2);
        const stdDev = Math.sqrt(varSum / state.BB_PERIOD);

        bbMiddleData.push({ time: formattedData[i].time, value: sma });
        bbUpperData.push({ time: formattedData[i].time, value: sma + (state.BB_STD_DEV * stdDev) });
        bbLowerData.push({ time: formattedData[i].time, value: sma - (state.BB_STD_DEV * stdDev) });
    }
    state.bbMiddleSeries.setData(bbMiddleData);
    state.bbUpperSeries.setData(bbUpperData);
    state.bbLowerSeries.setData(bbLowerData);

    const wtData = calculateMTFWaveTrend(formattedData, state.WT_TF, state.WT_CHANNEL_LEN, state.WT_AVG_LEN, state.WT_SIG_LEN, state.WT_ALLOW_REPAINT);
    state.lastWtData = wtData;
    state.wt1Series.setData(wtData.wt1Data);
    state.wt2Series.setData(wtData.wt2Data);

    const macdData = calculateMTFMacd(formattedData, state.MACD_TF, state.MACD_FAST, state.MACD_SLOW, state.MACD_SIG, state.MACD_ALLOW_REPAINT);
    state.lastMacdData = macdData;
    state.macdLineSeries.setData(macdData.macdData);
    state.macdSigSeries.setData(macdData.sigData);
    state.macdHistSeries.setData(macdData.histData);

    const stochData = calculateMTFStochRSI(formattedData, state.STOCH_TF, state.STOCH_RSI_LEN, state.STOCH_LEN, state.STOCH_K, state.STOCH_D, state.STOCH_ALLOW_REPAINT);
    state.lastStochData = stochData;
    state.stochRsiKSeries.setData(stochData.kData);
    state.stochRsiDSeries.setData(stochData.dData);

    const vwapData = calculateMTFVWAPClimax(formattedData, state.V_TF, state.V_VWAP_WINDOW, state.V_VWAP_SIGMA, state.V_VOL_LOOKBACK, state.V_VOL_MULT, state.V_WICK_RATIO, state.V_ALLOW_REPAINT);
    state.lastVwapData = vwapData;
    if (state.vwapSeries) state.vwapSeries.setData(vwapData.vwapData);
    if (state.vwapUpperSeries) state.vwapUpperSeries.setData(vwapData.upperBandData);
    if (state.vwapLowerSeries) state.vwapLowerSeries.setData(vwapData.lowerBandData);

    if (state.volHistSeries && vwapData.volHistData) state.volHistSeries.setData(vwapData.volHistData);
    if (state.volMaSeries && vwapData.volMaData) state.volMaSeries.setData(vwapData.volMaData);
    if (state.volSurgeThreshSeries && vwapData.volSurgeThreshData) state.volSurgeThreshSeries.setData(vwapData.volSurgeThreshData);

    if (state.markerUpperSeries && state.markerLowerSeries) {
        state.markerUpperSeries.setData(formattedData.map(d => ({ time: d.time, value: d.high * 1.0008 })));
        state.markerLowerSeries.setData(formattedData.map(d => ({ time: d.time, value: d.low * 0.9992 })));
    }

    applyIndicatorMarkers();
    renderSupertrend();
}

export function updateIndicatorsLive() {
    const data = state.klineData;
    if (!data || data.length === 0) return;

    if (data.length >= state.maPeriod) {
        let sum = 0;
        for (let j = 0; j < state.maPeriod; j++) sum += data[data.length - 1 - j].close;
        state.maSeries.update({ time: data[data.length - 1].time, value: sum / state.maPeriod });
    }

    if (data.length >= state.BB_PERIOD) {
        let sum = 0;
        for (let j = 0; j < state.BB_PERIOD; j++) sum += data[data.length - 1 - j].close;
        const sma = sum / state.BB_PERIOD;
        let varSum = 0;
        for (let j = 0; j < state.BB_PERIOD; j++) varSum += Math.pow(data[data.length - 1 - j].close - sma, 2);
        const stdDev = Math.sqrt(varSum / state.BB_PERIOD);
        const t = data[data.length - 1].time;
        state.bbMiddleSeries.update({ time: t, value: sma });
        state.bbUpperSeries.update({ time: t, value: sma + state.BB_STD_DEV * stdDev });
        state.bbLowerSeries.update({ time: t, value: sma - state.BB_STD_DEV * stdDev });
    }

    const wtData = calculateMTFWaveTrend(data, state.WT_TF, state.WT_CHANNEL_LEN, state.WT_AVG_LEN, state.WT_SIG_LEN, state.WT_ALLOW_REPAINT);
    state.lastWtData = wtData;
    if (wtData.wt1Data.length > 0) {
        state.wt1Series.update(wtData.wt1Data[wtData.wt1Data.length - 1]);
        state.wt2Series.update(wtData.wt2Data[wtData.wt2Data.length - 1]);
    }

    const macdData = calculateMTFMacd(data, state.MACD_TF, state.MACD_FAST, state.MACD_SLOW, state.MACD_SIG, state.MACD_ALLOW_REPAINT);
    state.lastMacdData = macdData;
    if (macdData.macdData.length > 0) {
        state.macdLineSeries.update(macdData.macdData[macdData.macdData.length - 1]);
        state.macdSigSeries.update(macdData.sigData[macdData.sigData.length - 1]);
        state.macdHistSeries.update(macdData.histData[macdData.histData.length - 1]);
    }

    const stochData = calculateMTFStochRSI(data, state.STOCH_TF, state.STOCH_RSI_LEN, state.STOCH_LEN, state.STOCH_K, state.STOCH_D, state.STOCH_ALLOW_REPAINT);
    state.lastStochData = stochData;
    if (stochData.kData.length > 0) {
        state.stochRsiKSeries.update(stochData.kData[stochData.kData.length - 1]);
        state.stochRsiDSeries.update(stochData.dData[stochData.dData.length - 1]);
    }

    const vwapData = calculateMTFVWAPClimax(data, state.V_TF, state.V_VWAP_WINDOW, state.V_VWAP_SIGMA, state.V_VOL_LOOKBACK, state.V_VOL_MULT, state.V_WICK_RATIO, state.V_ALLOW_REPAINT);
    state.lastVwapData = vwapData;
    if (vwapData.vwapData.length > 0 && state.vwapSeries) {
        state.vwapSeries.update(vwapData.vwapData[vwapData.vwapData.length - 1]);
        state.vwapUpperSeries.update(vwapData.upperBandData[vwapData.upperBandData.length - 1]);
        state.vwapLowerSeries.update(vwapData.lowerBandData[vwapData.lowerBandData.length - 1]);
    }
    if (vwapData.volHistData && vwapData.volHistData.length > 0 && state.volHistSeries) {
        state.volHistSeries.update(vwapData.volHistData[vwapData.volHistData.length - 1]);
        state.volMaSeries.update(vwapData.volMaData[vwapData.volMaData.length - 1]);
        state.volSurgeThreshSeries.update(vwapData.volSurgeThreshData[vwapData.volSurgeThreshData.length - 1]);
    }

    if (state.markerUpperSeries && state.markerLowerSeries && data.length > 0) {
        const lastBar = data[data.length - 1];
        state.markerUpperSeries.update({ time: lastBar.time, value: lastBar.high * 1.0008 });
        state.markerLowerSeries.update({ time: lastBar.time, value: lastBar.low * 0.9992 });
    }

    applyIndicatorMarkers();
    renderSupertrend();
}

export function initCharts(chartContainer, wtChartContainer, macdChartContainer, stochChartContainer, volChartContainer) {
    state.chart = LightweightCharts.createChart(chartContainer, {
        width: chartContainer.clientWidth || 600,
        height: chartContainer.clientHeight || 400,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            minimumWidth: 80
        },
        localization: {
            timeFormatter: (time) => {
                const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
                const d = new Date(time * 1000 + KST_OFFSET_MS);
                const year = d.getUTCFullYear();
                const month = String(d.getUTCMonth() + 1).padStart(2, '0');
                const day = String(d.getUTCDate()).padStart(2, '0');
                const h = String(d.getUTCHours()).padStart(2, '0');
                const m = String(d.getUTCMinutes()).padStart(2, '0');
                return `${year}-${month}-${day} ${h}:${m}`;
            }
        },
        timeScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            timeVisible: true,
            secondsVisible: false,
            tickMarkFormatter: (time, tickMarkType) => {
                const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
                const d = new Date(time * 1000 + KST_OFFSET_MS);

                if (tickMarkType === 0) return d.getUTCFullYear().toString();
                if (tickMarkType === 1) return (d.getUTCMonth() + 1) + '월';
                if (tickMarkType === 2) return d.getUTCDate() + '일';
                if (tickMarkType === 3) {
                    const h = String(d.getUTCHours()).padStart(2, '0');
                    const m = String(d.getUTCMinutes()).padStart(2, '0');
                    return `${h}:${m}`;
                }
                const h = String(d.getUTCHours()).padStart(2, '0');
                const m = String(d.getUTCMinutes()).padStart(2, '0');
                const s = String(d.getUTCSeconds()).padStart(2, '0');
                return `${h}:${m}:${s}`;
            }
        },
    });

    state.candleSeries = state.chart.addCandlestickSeries({
        upColor: '#2ebd85', downColor: '#f6465d',
        borderDownColor: '#f6465d', borderUpColor: '#2ebd85',
        wickDownColor: '#f6465d', wickUpColor: '#2ebd85',
    });

    state.maSeries = state.chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-ma')?.checked });
    state.bbUpperSeries = state.chart.addLineSeries({ color: 'rgba(56, 189, 248, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-bb')?.checked });
    state.bbMiddleSeries = state.chart.addLineSeries({ color: 'rgba(56, 189, 248, 0.5)', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-bb')?.checked });
    state.bbLowerSeries = state.chart.addLineSeries({ color: 'rgba(56, 189, 248, 0.5)', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-bb')?.checked });

    state.vwapSeries = state.chart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5, title: 'VWAP', crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-vwap')?.checked });
    state.vwapUpperSeries = state.chart.addLineSeries({ color: '#f43f5e', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: '+2.0σ', crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-vwap')?.checked });
    state.vwapLowerSeries = state.chart.addLineSeries({ color: '#10b981', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: '-2.0σ', crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false, visible: document.getElementById('toggle-vwap')?.checked });

    // Invisible floating offset series for spacing out V-Climax markers comfortably from candles
    state.markerUpperSeries = state.chart.addLineSeries({
        color: 'transparent',
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        autoscaleInfoProvider: () => null
    });
    state.markerLowerSeries = state.chart.addLineSeries({
        color: 'transparent',
        lineWidth: 1,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        autoscaleInfoProvider: () => null
    });

    // Initialize WaveTrend Chart
    state.wtChart = LightweightCharts.createChart(wtChartContainer, {
        width: wtChartContainer.clientWidth || 600,
        height: wtChartContainer.clientHeight || 150,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            minimumWidth: 80,
        },
        timeScale: { visible: false },
    });

    state.wtChart.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.1 },
    });

    state.wt1Series = state.wtChart.addLineSeries({ color: '#2ebd85', lineWidth: 1.5, title: 'WT1', crosshairMarkerVisible: true });
    state.wt2Series = state.wtChart.addLineSeries({ color: '#f6465d', lineWidth: 1.5, title: 'WT2', lineStyle: LightweightCharts.LineStyle.Dashed, crosshairMarkerVisible: true });
    updateWTPriceLines();

    // Initialize MACD Chart
    state.macdChart = LightweightCharts.createChart(macdChartContainer, {
        width: macdChartContainer.clientWidth || 600,
        height: macdChartContainer.clientHeight || 150,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            minimumWidth: 80,
        },
        timeScale: { visible: false },
    });

    state.macdChart.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.1 },
    });

    state.macdLineSeries = state.macdChart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5, title: 'MACD', crosshairMarkerVisible: true });
    state.macdSigSeries = state.macdChart.addLineSeries({ color: '#fb923c', lineWidth: 1.5, title: 'Signal', crosshairMarkerVisible: true });
    state.macdHistSeries = state.macdChart.addHistogramSeries({
        color: '#26a69a',
        priceFormat: { type: 'volume' },
        priceScaleId: 'right'
    });

    // Initialize Stochastic RSI Chart
    state.stochRsiChart = LightweightCharts.createChart(stochChartContainer, {
        width: stochChartContainer.clientWidth || 600,
        height: stochChartContainer.clientHeight || 150,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
        grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.1)',
            minimumWidth: 80,
        },
        timeScale: { visible: false },
    });

    state.stochRsiChart.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.1 },
    });

    state.stochRsiKSeries = state.stochRsiChart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5, title: '%K', crosshairMarkerVisible: true });
    state.stochRsiDSeries = state.stochRsiChart.addLineSeries({ color: '#fb923c', lineWidth: 1.5, title: '%D', lineStyle: LightweightCharts.LineStyle.Dashed, crosshairMarkerVisible: true });
    updateStochPriceLines();

    // Initialize Volume Sub Chart
    if (volChartContainer) {
        state.volChart = LightweightCharts.createChart(volChartContainer, {
            width: volChartContainer.clientWidth || 600,
            height: volChartContainer.clientHeight || 130,
            layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#94a3b8' },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
                minimumWidth: 80,
            },
            timeScale: { visible: false },
        });

        state.volChart.priceScale('right').applyOptions({
            autoScale: true,
            scaleMargins: { top: 0.15, bottom: 0 },
        });

        state.volHistSeries = state.volChart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'right'
        });
        state.volMaSeries = state.volChart.addLineSeries({ color: '#38bdf8', lineWidth: 1.5, title: 'Vol MA30', crosshairMarkerVisible: true });
        state.volSurgeThreshSeries = state.volChart.addLineSeries({ color: '#f59e0b', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, title: 'Surge (1.8x)', crosshairMarkerVisible: true });
    }

    // Sync time scales
    const allCharts = [state.chart, state.wtChart, state.macdChart, state.stochRsiChart];
    if (state.volChart) allCharts.push(state.volChart);

    allCharts.forEach(source => {
        source.timeScale().subscribeVisibleLogicalRangeChange(logicalRange => {
            allCharts.forEach(target => {
                if (target !== source) {
                    target.timeScale().setVisibleLogicalRange(logicalRange);
                }
            });
        });
    });

    // Crosshair Sync
    chartContainer.addEventListener('mouseenter', () => state.activeChart = state.chart);
    wtChartContainer.addEventListener('mouseenter', () => state.activeChart = state.wtChart);
    macdChartContainer.addEventListener('mouseenter', () => state.activeChart = state.macdChart);
    stochChartContainer.addEventListener('mouseenter', () => state.activeChart = state.stochRsiChart);
    if (volChartContainer) volChartContainer.addEventListener('mouseenter', () => state.activeChart = state.volChart);

    chartContainer.addEventListener('mouseleave', () => { if (state.activeChart === state.chart) state.activeChart = null; });
    wtChartContainer.addEventListener('mouseleave', () => { if (state.activeChart === state.wtChart) state.activeChart = null; });
    macdChartContainer.addEventListener('mouseleave', () => { if (state.activeChart === state.macdChart) state.activeChart = null; });
    stochChartContainer.addEventListener('mouseleave', () => { if (state.activeChart === state.stochRsiChart) state.activeChart = null; });
    if (volChartContainer) volChartContainer.addEventListener('mouseleave', () => { if (state.activeChart === state.volChart) state.activeChart = null; });

    function syncCrosshair(sourceChart, param) {
        if (state.activeChart && sourceChart !== state.activeChart) return;

        const time = param && param.time;
        if (!time) {
            if (sourceChart !== state.chart) state.chart.clearCrosshairPosition();
            if (sourceChart !== state.wtChart) state.wtChart.clearCrosshairPosition();
            if (sourceChart !== state.macdChart) state.macdChart.clearCrosshairPosition();
            if (sourceChart !== state.stochRsiChart) state.stochRsiChart.clearCrosshairPosition();
            if (state.volChart && sourceChart !== state.volChart) state.volChart.clearCrosshairPosition();
            return;
        }

        if (sourceChart !== state.chart) {
            let price = 0;
            if (state.klineData) {
                const match = state.klineData.find(d => d.time === time);
                if (match) price = match.close;
            }
            state.chart.setCrosshairPosition(price, time, state.candleSeries);
        }
        if (sourceChart !== state.wtChart) {
            let price = 0;
            if (state.lastWtData && state.lastWtData.wt1Data) {
                const match = state.lastWtData.wt1Data.find(d => d.time === time);
                if (match && match.value !== undefined) price = match.value;
            }
            state.wtChart.setCrosshairPosition(price, time, state.wt1Series);
        }
        if (sourceChart !== state.macdChart) {
            let price = 0;
            if (state.lastMacdData && state.lastMacdData.macdData) {
                const match = state.lastMacdData.macdData.find(d => d.time === time);
                if (match && match.value !== undefined) price = match.value;
            }
            state.macdChart.setCrosshairPosition(price, time, state.macdLineSeries);
        }
        if (sourceChart !== state.stochRsiChart) {
            let price = 0;
            if (state.lastStochData && state.lastStochData.kData) {
                const match = state.lastStochData.kData.find(d => d.time === time);
                if (match && match.value !== undefined) price = match.value;
            }
            state.stochRsiChart.setCrosshairPosition(price, time, state.stochRsiKSeries);
        }
        if (state.volChart && sourceChart !== state.volChart) {
            let price = 0;
            if (state.lastVwapData && state.lastVwapData.volMaData) {
                const match = state.lastVwapData.volMaData.find(d => d.time === time);
                if (match && match.value !== undefined) price = match.value;
            }
            state.volChart.setCrosshairPosition(price, time, state.volMaSeries);
        }
    }

    state.chart.subscribeCrosshairMove(param => syncCrosshair(state.chart, param));
    state.wtChart.subscribeCrosshairMove(param => syncCrosshair(state.wtChart, param));
    state.macdChart.subscribeCrosshairMove(param => syncCrosshair(state.macdChart, param));
    state.stochRsiChart.subscribeCrosshairMove(param => syncCrosshair(state.stochRsiChart, param));
    if (state.volChart) state.volChart.subscribeCrosshairMove(param => syncCrosshair(state.volChart, param));
}
