
const { decrypt, encrypt } = require('./crypto');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const db = require('../db');
const { setCache } = require('../config/redisClient');

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
        .leftJoin('pandits as p', 'p.id', 'o.panditId')
        .where('o.userId', userId)
        .whereIn('o.status', ['pending', 'continue'])
        .select(
            'o.*',
            'p.name',
            'p.profile'
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

const socketParseEventData = (message) => {
    return JSON.parse(message);
}

const isValidMobile = (mobile) => /^[0-9]{8,12}$/.test(mobile);


function deepParse(input) {
    let result = input;

    try {
        while (typeof result === "string") {
            result = JSON.parse(result);
        }
    } catch (err) {
        // jo parse fail thay to last valid value return karo
        return result;
    }

    return result;
}

/** Always return money with max 2 decimal places. */
function roundMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Number(n.toFixed(2));
}

function convertCurrency(amount, rate) {
    const r = Number(rate);
    return roundMoney(Number(amount || 0) / (Number.isFinite(r) && r !== 0 ? r : 1));
}

/** User wallet cut: (inrAmount / pandit_inr_rate) * user_inr_rate */
function calculateUserChargeAmount(inrAmount, panditInrRate, userInrRate) {
    const pRate = Number(panditInrRate) || 1;
    const uRate = Number(userInrRate) || 1;
    return roundMoney((Number(inrAmount || 0) / pRate) * uRate);
}

/** Round known money keys on an object (mutates and returns). */
function roundMoneyFields(obj, fields = []) {
    if (!obj || typeof obj !== 'object') return obj;
    for (const key of fields) {
        if (obj[key] != null && obj[key] !== '') {
            obj[key] = roundMoney(obj[key]);
        }
    }
    return obj;
}

const generateLoginResponse = async (existing, currency) => {
    const token = jwt.sign({ userId: existing.id, username: existing.name, mobile: existing.mobile, currency }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
    // hide password
    const encryptToken = encrypt(token);

    // Store token in Redis with key user_username (or user_mobile if username doesn't exist)
    const username = existing.id;
    const redisKey = `${process.env.REDIS_USER_KEY}${username}`;
    // Set TTL to match JWT expiration (1 hour = 3600 seconds)
    const jwtExpiry = process.env.JWT_EXPIRES_IN || '1h';
    let ttlSeconds = 3600; // default 1 hour
    if (jwtExpiry.includes('h')) {
        ttlSeconds = parseInt(jwtExpiry.replace('h', '')) * 3600;
    }
    await setCache(redisKey, encryptToken, ttlSeconds);

    // const [{ count }] = await db('orders')
    //     .count('* as count')
    //     .where({ user_id: existing.id })
    //     .whereIn('status', ['continue', 'completed', 'pending']);
    // const is_free = count == 0 || existing?.is_free_order_available ? true : false
    const is_free = existing?.is_free_order_available || false
    return {
        success: true,
        data: {
            id: existing?.id,
            name: existing?.name,
            profile: existing?.profile,
            avatar: existing?.avatar,
            mobile: existing?.mobile,
            allow_notification: existing?.allow_notification,
            country_code: existing?.country_code,
            token: encryptToken,
            is_free,
            referal_code: existing?.referal_code || '',
        }, message: 'Otp Verify Successfully'
    }
}

module.exports = {
    decodeJWT,
    checkOrders,
    socketParseEventData,
    isValidMobile,
    deepParse,
    roundMoney,
    convertCurrency,
    calculateUserChargeAmount,
    roundMoneyFields,
    generateLoginResponse,
};
