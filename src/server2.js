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

// Keep track of online sockets separately for users and admins
// Map: id -> socketId
// const orders = {};

/**
 * Helper: emit updated online lists
 */
// function broadcastOnline() {
// io.emit('online_list', {
//     users: Array.from(onlineUsers.keys()),
//     pandits: Array.from(onlinePandits.keys())
// });
// }

/**
 * REST API: get chat "rooms" for a given user/admin
 * For simplicity, returns list of counterpart ids who have chatted with this actor,
 * plus last message and unread count.
 */
// app.get('/api/rooms', async (req, res) => {
//     const { type, id } = req.query;
//     if (!['user', 'admin'].includes(type)) {
//         return res.status(400).json({ error: 'Invalid type' });
//     }

//     try {
//         // Get distinct counterparts
//         const rooms = await db('chats')
//             .select(
//                 db.raw(`
//             CASE
//               WHEN sender_type = ? AND sender_id = ? THEN receiver_type
//               ELSE sender_type
//             END as other_type
//           `, [type, id]),
//                 db.raw(`
//             CASE
//               WHEN sender_type = ? AND sender_id = ? THEN receiver_id
//               ELSE sender_id
//             END as other_id
//           `, [type, id])
//             )
//             .max('created_at as last_at')
//             .where(function () {
//                 this.where(function () {
//                     this.where('sender_type', type).andWhere('sender_id', id)
//                 }).orWhere(function () {
//                     this.where('receiver_type', type).andWhere('receiver_id', id)
//                 })
//             })
//             .groupBy('other_type', 'other_id');

//         // Get last message + unread count per counterpart
//         const results = await Promise.all(rooms.map(async r => {
//             // last message
//             const lastMsg = await db('chats')
//                 .where(function () {
//                     this.where({ sender_type: r.other_type, sender_id: r.other_id, receiver_type: type, receiver_id: id })
//                         .orWhere({ sender_type: type, sender_id: id, receiver_type: r.other_type, receiver_id: r.other_id })
//                 })
//                 .orderBy('created_at', 'desc')
//                 .first();

//             // unread count
//             const unreadCountObj = await db('chats')
//                 .where({ receiver_type: type, receiver_id: id, sender_type: r.other_type, sender_id: r.other_id, is_read: false })
//                 .count('* as unread_count')
//                 .first();

//             return [{
//                 other_type: r.other_type,
//                 other_id: r.other_id,
//                 last_message: lastMsg?.message || null,
//                 last_at: lastMsg?.created_at || null,
//                 unread_count: parseInt(unreadCountObj.unread_count || 0)
//             }];
//         }));

//         res.json(results);
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ error: 'Server error', details: err.message });
//     }
// });

/**
 * REST API: get messages between two parties
 * /api/messages?me_type=user&me_id=1&other_type=admin&other_id=1
 */
// app.get('/api/messages', async (req, res) => {
//     const { me_type, me_id, other_type, other_id, limit = 50, offset = 0 } = req.query;
//     if (!me_type || !me_id || !other_type || !other_id) {
//         return res.status(400).json({ error: 'Missing params' });
//     }

//     try {
//         const messages = await db('chats')
//             .where(function () {
//                 this.where({ sender_type: me_type, sender_id: me_id, receiver_type: other_type, receiver_id: other_id })
//                     .orWhere({ sender_type: other_type, sender_id: other_id, receiver_type: me_type, receiver_id: me_id });
//             })
//             .orderBy('created_at', 'asc')
//             .limit(limit)
//             .offset(offset);

//         // Mark messages received by me as read
//         await db('chats')
//             .where({ receiver_type: me_type, receiver_id: me_id, sender_type: other_type, sender_id: other_id, is_read: false })
//             .update({ is_read: true });

//         res.json(messages);
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ error: 'Server error' });
//     }
// });

/**
 * Socket.IO events:
 * - client emits 'go_online' with { id, type } where type = 'user'|'admin'
 * - client emits 'private_message' with { sender_type, sender_id, receiver_type, receiver_id, message }
 * - client emits 'typing' and 'stop_typing' with { from_type, from_id, to_type, to_id }
 */
// const onlineUsers = new Map();
RedisCache.initializeRedis();
io.on('connection', (socket) => {
    console.log('socket connected', socket.id);
    socket.on('go_online', ({ orderId, from_id, type, to_id }) => {
        socket.join(orderId);
        socket.orderId = orderId;
        socket.userId = from_id;
        socket.type = type;
        console.log(`${type} joined room ${orderId}`);

        socket.to(orderId).emit('online');
    });

    socket.on('user_register', async ({ token }) => {
        // console.log("user_register token", token);
        const response = decodeJWT(token);
        if (response?.success && response?.data?.userId) {
            const key = `user_${response?.data?.userId}`;
            const socketId = socket.id
            RedisCache.setCache(key, socketId);
            // onlineUsers.set(key, socket.id);
            const userOrder = await checkOrders(response?.data?.userId);
            console.log("userOrder", userOrder);
            setTimeout(() => {
                // const socketId = onlineUsers.get(key);
                if (userOrder?.pendingOrder?.length > 0) {
                    console.log('inside pending:', socketId);
                    socket.to(socketId).emit('wait_for_pandit', userOrder?.pendingOrder);
                }
                if (userOrder?.continueOrder?.length > 0) {
                    console.log('inside continue order:', socketId);

                    socket.to(socketId).emit('pandit_accepted', userOrder?.continueOrder);
                }
            }, 10000);
            console.log('Registered:', key, socket.id);
        }
    });


    socket.on('emit_to_user_for_register', ({ key, payload }) => {
        // const socketId = onlineUsers.get(key);
        const socketId = RedisCache.getCache(key);
        console.log("socketId", socketId);
        if (socketId) {
            socket.to(socketId).emit('wait_for_pandit', payload);
        }
    });

    socket.on('emit_to_user_for_pandit_accept', ({ key, payload }) => {
        // const socketId = onlineUsers.get(key);
        const socketId = RedisCache.getCache(key);
        console.log("socketId", socketId);
        if (socketId) {
            socket.to(socketId).emit('pandit_accepted', payload);
        }
    });


    // socket.on('go_online', async (payload) => {
    //     const { id, type } = payload || {};
    //     if (!id || !type) return;

    //     if (type === 'user') {
    //         onlineUsers.set(String(id), socket.id);
    //         await db('users').where({ id }).update({ online: true });
    //     } else if (type === 'pandit') {
    //         onlinePandits.set(String(id), socket.id);
    //         await db('pandits').where({ id }).update({ online: true });
    //     }

    //     broadcastOnline();
    // });

    socket.on('typing', (data) => {
        const { orderId } = data;
        console.log("typing orderId", orderId);
        // const targetSocket = (to_type === 'user') ? onlineUsers.get(String(to_id)) : onlinePandits.get(String(to_id));
        // if (targetSocket) io.to(targetSocket).emit('typing', { from_type, from_id });
        socket.to(orderId).emit('typing');
    });

    socket.on('stop_typing', (data) => {
        const { orderId } = data;
        console.log("stop_typing orderId", orderId);

        // const targetSocket = (to_type === 'user') ? onlineUsers.get(String(to_id)) : onlinePandits.get(String(to_id));
        // if (targetSocket) io.to(targetSocket).emit('stop_typing', { from_type, from_id });
        socket.to(orderId).emit('stop_typing');
    });

    socket.on('go_offline', (data) => {
        const { orderId } = data;
        console.log("go_offline orderId", orderId);
        // const targetSocket = (to_type === 'user') ? onlineUsers.get(String(to_id)) : onlinePandits.get(String(to_id));
        // if (targetSocket) io.to(targetSocket).emit('stop_typing', { from_type, from_id });
        socket.to(orderId).emit('offline');
        socket.leave(orderId);
    });


    // 🔹 JOIN ROOM
    // socket.on('join_chat', ({ orderId, userId, role }) => {
    //     socket.join(orderId);
    //     socket.orderId = orderId;
    //     socket.userId = userId;
    //     socket.role = role;

    //     console.log(`${role} joined room ${orderId}`);
    // });

    // 🔹 SEND MESSAGE
    // socket.on('send_message', (data) => {
    //     const { orderId } = data;

    //     // sirf usi room ko emit

    // });

    // 🔹 TYPING
    // socket.on('typing', ({ orderId, from_id }) => {
    //     console.log("orderId, from_id", orderId, from_id);
    //     socket.to(orderId).emit('typing', { from_id });
    // });

    // socket.on('stop_typing', ({ orderId }) => {
    //     console.log("stop_typing orderId", orderId);
    //     socket.to(orderId).emit('stop_typing');
    // });

    socket.on('emit_to_chat_completed', ({ user, orderId }) => {
        socket.to(orderId).emit('order_completed');
        socket.leave(orderId);
        console.log(`Socket ${socket.id} left room ${orderId}`);
    });

    socket.on('emit_to_user', ({ toType, toId, orderId, payload }) => {
        console.log("cdscd", toType, toId, payload);
        // const targetSocket =
        //     toType === 'user'
        //         ? onlineUsers.get(String(toId))
        //         : onlinePandits.get(String(toId));
        // console.log("targetSocket", targetSocket);

        socket.to(orderId).emit('receive_message', payload);

        // if (targetSocket) {

        //     io.to(targetSocket).emit('receive_message', payload);
        // }
    });

    socket.on('disconnect', async () => {
        // find who disconnected (search in maps)
        // const userEntry = Array.from(onlineUsers.entries()).find(([, sid]) => sid === socket.id);
        // const adminEntry = Array.from(onlinePandits.entries()).find(([, sid]) => sid === socket.id);

        // if (userEntry) {
        //     const [id] = userEntry;
        //     onlineUsers.delete(id);
        //     await db('users').where({ id }).update({ online: false });
        // }
        // if (adminEntry) {
        //     const [id] = adminEntry;
        //     onlinePandits.delete(id);
        //     await db('pandits').where({ id }).update({ online: false });
        // }

        // broadcastOnline();
        console.log('socket disconnected', socket.id);
    });

});

const PORT = 3001
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
