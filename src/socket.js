const WebSocket = require('ws');

// const WS_URL = 'ws://localhost:3001';
const WS_URL = 'wss://socket.astrotalkguruji.com';

let socket;
let retries = 0;
const MAX_RETRIES = 20;

function connect() {
    console.log('🔌 Connecting WS...');

    socket = new WebSocket(WS_URL);

    socket.on('open', () => {
        console.log('✅ Connected');
        retries = 0;
    });

    socket.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            console.log('📩 Received:', msg);
        } catch {
            console.log('Raw:', data.toString());
        }
    });

    socket.on('close', () => {
        console.log('❌ Disconnected');
        retryConnect();
    });

    socket.on('error', (err) => {
        console.error('⚠️ Error:', err.message);
        socket.close();
    });
}

function callEvent(event, data) {
    socket.send(JSON.stringify({
        event,
        data
    }))
}

function retryConnect() {
    if (retries >= MAX_RETRIES) return;

    const delay = Math.min(1000 * 2 ** retries, 10000);
    retries++;

    console.log(`🔁 Reconnect in ${delay}ms`);
    setTimeout(connect, delay);
}

connect();

module.exports = { callEvent };
