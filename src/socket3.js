const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { decodeJWT, checkOrders, socketParseEventData } = require('./utils/decodeJWT');
// const RedisCache = require('./config/redisClient');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// RedisCache.initializeRedis();

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
    console.log("inside send")
    console.log("event", event);
    console.log("payload", payload);
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event, payload }));
    }
}

const clients = new Map();

wss.on('connection', (ws) => {
    const socketId = Date.now() + '_' + Math.random();
    ws.id = socketId;
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
                // await RedisCache.setCache(key, JSON.stringify(ws));
                clients.set(key, ws);
                const orders = await checkOrders(response.data.userId);
                if (orders?.awaitforPanditOrder?.length)
                    send(ws, 'wait_for_pandit', orders.awaitforPanditOrder);

                if (orders?.waitforUserOrder?.length)
                    send(ws, 'pandit_accepted', orders.waitforUserOrder);

                if (orders?.continueOrder?.length)
                    send(ws, 'user_continue_order', orders.continueOrder);
            }
        }

        if (event === 'pandit_register') {
            const response = decodeJWT(data.token);
            console.log("inside pandit register decode token", response);
            if (response?.success) {
                const key = `pandit_${response.data.userId}`;
                // await RedisCache.setCache(key, JSON.stringify(ws));
                clients.set(key, ws);
            }
        }

        if (event === 'emit_to_user_for_register') {
            // const socketId = await RedisCache.getCache(data?.key);
            const socketId = clients.get(data?.key);

            console.log("socketId", socketId);
            if (socketId) send(socketId, 'wait_for_pandit', data?.payload);
        }

        if (event === 'typing' || event == 'stop_typing') {
            const { orderId, id, user_type, type } = data;
            console.log("typing data", data);
            const key = `${user_type}_${id}`
            // const socketId = await RedisCache.getCache(key);
            const socketId = clients.get(key);
            console.log("typing key", key, "socketId", socketId);
            if (socketId) send(socketId, event, { orderId, type });
        }

        if (event === 'emit_to_chat_completed') {
            // const socketId = await RedisCache.getCache(data?.key);
            const socketId = clients.get(data?.key);
            console.log("socketId", socketId);
            if (socketId) send(socketId, 'order_completed', { orderId: data?.orderId });
        }

        if (event === 'emit_to_user') {
            // const socketId = await RedisCache.getCache(data?.key);
            const socketId = clients.get(data?.key);
            console.log("socketId", socketId);
            if (socketId) send(socketId, 'receive_message', { payload: data?.payload });
        }
    });

    ws.on('close', () => {
        // leaveRoom(ws);
        // for (const [key, socket] of userSockets.entries()) {
        //     if (socket === ws) userSockets.delete(key);
        // }
        console.log('WS disconnected:', ws.id);
    });
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`WS Server running on ${PORT}`);
});
