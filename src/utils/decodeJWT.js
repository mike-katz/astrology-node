
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

const checkOrders = async (userId) => {
    const orders = await db('orders as o')
        .leftJoin('users as u', 'u.id', 'o.userId')
        .where('o.userId', userId)
        .whereIn('o.status', ['pending', 'continue'])
        .select(
            'o.*',
            'u.name',
            'u.profile'
        );

    const awaitforPanditOrder = [];
    const waitforUserOrder = [];
    const continueOrder = [];

    for (const order of orders) {
        if (order.status === 'pending' && order.is_accept === false) {
            awaitforPanditOrder.push(order);
        } else if (order.status === 'pending' && order.is_accept === true) {
            waitforUserOrder.push(order);
        } else if (order.status === 'continue') {
            continueOrder.push(order);
        }
    }

    return {
        awaitforPanditOrder,
        waitforUserOrder,
        continueOrder
    };
};

module.exports = { decodeJWT, checkOrders };

