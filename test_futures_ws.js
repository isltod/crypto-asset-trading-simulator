const WebSocket = require('ws');

// 바이낸스 USDS-M 선물 웹소켓 주소
// 단일 스트림: wss://fstream.binance.com/ws/btcusdt@kline_1m
// 다중 스트림: wss://fstream.binance.com/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m
const endpoint = 'wss://fstream.binance.com/stream?streams=btcusdt@kline_1m';

console.log(`[선물 테스트] 접속 시도 중... ${endpoint}`);
const ws = new WebSocket(endpoint);

ws.on('open', () => {
    console.log('[선물 테스트] 바이낸스 선물 웹소켓에 성공적으로 연결되었습니다.');
});

ws.on('message', (data) => {
    console.log('[수신된 원본 데이터 길이]:', data.length);
    console.log('[수신된 원본 데이터]:', data.toString());
    try {
        const raw = JSON.parse(data);
        const message = raw.data || raw;

        if (message && message.e === 'kline') {
            const kline = message.k;
            const isClosed = kline.x ? '마감됨' : '진행중';
            const currentTime = new Date().toLocaleTimeString();
            
            console.log(`[${currentTime}] 📈 심볼: ${message.s} | 시가: ${kline.o} | 고가: ${kline.h} | 저가: ${kline.l} | 종가(현재가): ${kline.c} | 거래량: ${kline.v} | 상태: ${isClosed}`);
        } else {
            console.log('[기타 메시지]:', raw);
        }
    } catch (e) {
        console.error('메시지 파싱 에러:', e.message);
    }
});

ws.on('error', (err) => {
    console.error('[에러 발생]:', err.message);
});

ws.on('close', () => {
    console.log('[연결 종료] 웹소켓 연결이 끊어졌습니다.');
});
