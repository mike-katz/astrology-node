const db = require('../db');
require('dotenv').config();
const crypto = require('crypto-js');
const serviceAccount = require('../config/astro-1e9f7-firebase-adminsdk-fbsvc-4f429f67a7.json');
const admin = require("firebase-admin");
const { emitToUser } = require('../utils/decodeJWT');
const socket = require("../socket");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

async function create(req, res) {
    const { panditId, type = 'chat' } = req.body;

    if (!panditId) {
        return res.status(400).json({ success: false, message: 'Please enter pandit' });
    }
    try {
        const user = await db('users').where({ id: req.userId }).first()
        if (user?.balance < 1) return res.status(400).json({ success: false, message: 'Please recharge your wallet.' });

        const pandit = await db('pandits').where({ id: panditId }).first()
        if (!pandit) return res.status(400).json({ success: false, message: 'Pandit not found.' });

        const continueOrder = await db('orders').where({ userId: req.userId, panditId, status: "continue", type }).first()
        if (continueOrder) return res.status(400).json({ success: false, message: 'Please complete your ongoing order.' });

        const order = await db('orders').where({ userId: req.userId, panditId }).first()
        const orderId = ((parseInt(crypto.lib.WordArray.random(16).toString(), 16) % 1e6) + '').padStart(15, '0');
        let deduction = 0
        if (!order) {
            //create 5 minute order
            deduction = (5 * pandit?.charge || 1);

        } else {
            deduction = (1 * pandit?.charge || 1);
        }
        if (user?.balance < deduction) return res.status(400).json({ success: false, message: 'Insufficient fund.' });
        const [saved] = await db('orders').insert({
            panditId,
            userId: req.userId,
            orderId,
            status: "pending",
            rate: pandit?.charge || 1,
            duration: 5,
            deduction,
            type
        }).returning('*');
        const token = false;
        if (token) {
            const message = {
                token,
                notification: {
                    title: `You have received ${type} order`,
                },

                // 🔔 Android
                android: {
                    notification: {
                        sound: 'default'
                    }
                },

                // 🔔 iOS
                apns: {
                    payload: {
                        aps: {
                            sound: 'default'
                        }
                    }
                },

                // 🔔 Web Browser
                webpush: {
                    notification: {
                        // icon: '/icon.png',
                        requireInteraction: true
                        // NOTE: Browsers play default sound automatically
                    }
                },
                data: {},

            };
            await admin.messaging().send(message);
        }

        socket.emit("emit_to_user_for_register", {
            key: `user_${req?.userId}`,
            payload: [{ ...saved, name: user?.name, profile: user?.profile }],
        });

        // emitToUser(req.userId, 'wait_for_pandit', saved)

        return res.status(200).json({ success: true, data: { orderId }, message: 'Order create Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function list(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;

        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const offset = (page - 1) * limit;
        const order = await db('orders as o').where({ userId: req.userId })
            .leftJoin('pandits as p', 'p.id', 'o.panditId')
            .leftJoin('chats as c', 'o.orderId', 'c.orderId')

            .groupBy(
                'o.id',
                'p.id'
            )
            .orderByRaw(`
            CASE trim(o.status)
                WHEN 'continue' THEN 1
                WHEN 'pending' THEN 2
                WHEN 'completed' THEN 3
                ELSE 4
            END
            `).select(
                "o.*",
                "p.name",
                "p.profile",
                // "c.lastmessage"
                db.raw('MAX(c.lastmessage) as lastmessage')

            ).limit(limit)
            .offset(offset);

        const [{ count }] = await db('orders')
            .count('* as count').where('userId', req?.userId);

        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: order
        }
        return res.status(200).json({ success: true, data: response, message: 'Order list Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}
module.exports = { create, list };