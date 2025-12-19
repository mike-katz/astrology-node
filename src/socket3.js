const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { decodeJWT, checkOrders, socketParseEventData } = require('./utils/decodeJWT');
const RedisCache = require('./config/redisClient');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

RedisCache.initializeRedis();

// 🔥 STATE
const clients = new Map();       // socketId -> ws
const userSockets = new Map();   // user_1 / pandit_2 -> ws
const orderRooms = new Map();    // orderId -> Set(ws)

function joinRoom(orderId, ws) {
    if (!orderRooms.has(orderId)) {
        orderRooms.set(orderId, new Set());
    }
    orderRooms.get(orderId).add(ws);
    ws.orderId = orderId;
}

function leaveRoom(ws) {
    if (ws.orderId && orderRooms.has(ws.orderId)) {
        orderRooms.get(ws.orderId).delete(ws);
    }
}

function send(ws, event, payload) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event, payload }));
    }
}

wss.on('connection', (ws) => {
    const socketId = Date.now() + '_' + Math.random();
    ws.id = socketId;
    clients.set(socketId, ws);

    console.log('WS connected:', socketId);

    ws.on('message', async (message) => {
        const datas = socketParseEventData(message);
        console.log("inside message log", datas);
        const { event, data } = datas;
        /* ---------------- USER REGISTER ---------------- */
        if (event === 'user_register') {
            const response = decodeJWT(data.token);
            console.log("inside user register decode token", response);
            if (response?.success) {
                const key = `user_${response.data.userId}`;
                userSockets.set(key, ws);
                await RedisCache.setCache(key, socketId);

                const orders = await checkOrders(response.data.userId);

                if (orders?.awaitforPanditOrder?.length)
                    send(ws, 'wait_for_pandit', orders.awaitforPanditOrder);

                if (orders?.waitforUserOrder?.length)
                    send(ws, 'pandit_accepted', orders.waitforUserOrder);

                if (orders?.continueOrder?.length)
                    send(ws, 'user_continue_order', orders.continueOrder);
            }
        }
    });

    ws.on('close', () => {
        leaveRoom(ws);
        clients.delete(ws.id);
        for (const [key, socket] of userSockets.entries()) {
            if (socket === ws) userSockets.delete(key);
        }
        console.log('WS disconnected:', ws.id);
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`WS Server running on ${PORT}`);
});
