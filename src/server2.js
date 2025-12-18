// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { decodeJWT, checkOrders } = require('./utils/decodeJWT');
const RedisCache = require('./config/redisClient');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: '*' }
});

RedisCache.initializeRedis();
io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    socket.on('user_register', async ({ token }) => {
        // console.log("user_register token", token);
        const response = decodeJWT(token);
        if (response?.success && response?.data?.userId) {
            const key = `user_${response?.data?.userId}`;
            const socketId = socket.id
            await RedisCache.setCache(key, socketId);
            // onlineUsers.set(key, socket.id);
            const userOrder = await checkOrders(response?.data?.userId);
            console.log("userOrder", userOrder);
            // setTimeout(() => {
            // const socketId = onlineUsers.get(key);
            if (userOrder?.awaitforPanditOrder?.length > 0) {
                console.log('inside pending:', socketId);
                io.to(socketId).emit('wait_for_pandit', userOrder?.awaitforPanditOrder);
            }
            if (userOrder?.waitforUserOrder?.length > 0) {
                console.log('inside pandit_accepted order:', socketId);
                io.to(socketId).emit('pandit_accepted', userOrder?.waitforUserOrder);
            }
            if (userOrder?.continueOrder?.length > 0) {
                console.log('inside continue order:', socketId);
                io.to(socketId).emit('user_continue_order', userOrder?.continueOrder);
            }
            // }, 5000);
            console.log('Registered:', key, socket.id);
        }
    });

    socket.on('pandit_register', async ({ token }) => {
        // console.log("user_register token", token);
        const response = decodeJWT(token);
        if (response?.success && response?.data?.userId) {
            const key = `pandit_${response?.data?.userId}`;
            const socketId = socket.id
            await RedisCache.setCache(key, socketId);
            // onlineUsers.set(key, socket.id);
            // const userOrder = await checkOrders(response?.data?.userId);
            // console.log("userOrder", userOrder);
            // setTimeout(() => {
            // const socketId = onlineUsers.get(key);
            // if (userOrder?.awaitforPanditOrder?.length > 0) {
            //     console.log('inside pending:', socketId);
            //     io.to(socketId).emit('wait_for_pandit', userOrder?.awaitforPanditOrder);
            // }
            // if (userOrder?.waitforUserOrder?.length > 0) {
            //     console.log('inside pandit_accepted order:', socketId);
            //     io.to(socketId).emit('pandit_accepted', userOrder?.waitforUserOrder);
            // }
            // if (userOrder?.continueOrder?.length > 0) {
            //     console.log('inside continue order:', socketId);
            //     io.to(socketId).emit('user_continue_order', userOrder?.continueOrder);
            // }
            // }, 5000);
            console.log('Registered:', key, socket.id);
        }
    });

    socket.on('emit_to_user_for_register', async ({ key, payload }) => {
        // const socketId = onlineUsers.get(key);
        const socketId = await RedisCache.getCache(key);
        console.log("socketId", socketId);
        if (socketId) {
            io.to(socketId).emit('wait_for_pandit', payload);
        }
    });

    socket.on('emit_to_user_for_pandit_accept', async ({ key, payload }) => {
        // const socketId = onlineUsers.get(key);
        const socketId = await RedisCache.getCache(key);
        console.log("emit_to_user_for_pandit_accept pandit_accepted socketId", socketId);
        if (socketId) {
            io.to(socketId).emit('pandit_accepted', payload);
        }
    });

    socket.on('typing', async (data) => {
        const { orderId, id, user_type, type } = data;
        const key = `${user_type}_${id}`
        const socketId = await RedisCache.getCache(key);
        console.log("typing key", key, "socketId", socketId);
        // const targetSocket = (to_type === 'user') ? onlineUsers.get(String(to_id)) : onlinePandits.get(String(to_id));
        // if (targetSocket) io.to(targetSocket).emit('typing', { from_type, from_id });
        if (socketId) {
            io.to(socketId).emit('typing', { orderId, type });
        }
    });

    socket.on('stop_typing', async (data) => {
        const { orderId, id, user_type, type } = data;
        const key = `${user_type}_${id}`
        const socketId = await RedisCache.getCache(key);
        console.log("stop_typing orderId", socketId, data);
        // const targetSocket = (to_type === 'user') ? onlineUsers.get(String(to_id)) : onlinePandits.get(String(to_id));
        // if (targetSocket) io.to(targetSocket).emit('stop_typing', { from_type, from_id });
        if (socketId) {
            io.to(socketId).emit('stop_typing', { orderId, type });
        }
    });

    socket.on('emit_to_chat_completed', ({ user, orderId }) => {
        socket.to(orderId).emit('order_completed');
        socket.leave(orderId);
        console.log(`Socket ${socket.id} left room ${orderId}`);
    });

    socket.on('emit_to_user', ({ toType, toId, orderId, payload }) => {
        console.log("cdscd", toType, toId, payload);
        socket.to(orderId).emit('receive_message', payload);
    });

    socket.on('disconnect', async () => {
        console.log('socket disconnected', socket.id);
    });

});

const PORT = 3001
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
