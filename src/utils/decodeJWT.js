
const { decrypt } = require('./crypto');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const db = require('../db');

const decodeJWT = (authHeader) => {
    try {
        const token = authHeader.split(' ')[1];
        const decryptToken = decrypt(token);
        // console.log("decryptToken", decryptToken);
        // console.log("process.env.JWT_SECRET", process.env.JWT_SECRET);
        const verified = jwt.verify(decryptToken, process.env.JWT_SECRET);
        return { success: true, data: verified }
    } catch (error) {
        return { success: false, message: "Something went wrong" }
    }
};

// const emitToUser = (
//     role='user',
//     id,
//     event: 'chat_request',
//     data: { fromUserId }
//   }) => {
// }
// ();

function emitToUser({ id, event, data }) {
    const key = `user_${id}`;
    const socketId = onlineUsers.get(key);

    if (socketId) {
        io.to(socketId).emit(event, data);
    }
}

const checkOrders = async (userId) => {
    const pendingOrder = await db('orders as o')
        .leftJoin('users as u', 'u.id', 'o.userId')
        .where({ "o.userId": userId, "o.status": "pending", is_accept: false })
        .select(
            'o.*',
            'u.name',
            'u.profile'
        );
    ;
    const continueOrder = await db('orders as o')
        .leftJoin('users as u', 'u.id', 'o.userId')
        .where({ "o.userId": userId, "o.status": "pending", is_accept: true })
        .select(
            'o.*',
            'u.name',
            'u.profile'
        );
    return { pendingOrder, continueOrder }
}

module.exports = { decodeJWT, emitToUser, checkOrders };

