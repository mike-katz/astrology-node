const db = require('../db');
require('dotenv').config();
const crypto = require('crypto-js');
const serviceAccount = require('../config/astro-1e9f7-firebase-adminsdk-fbsvc-4f429f67a7.json');
const admin = require("firebase-admin");
const { callEvent } = require("../socket");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

async function create(req, res) {
    const { panditId, type = 'chat', profile_id } = req.body;
    if (!panditId) {
        return res.status(400).json({ success: false, message: 'Please enter pandit' });
    }
    console.log("create order req.body", req.body);
    try {
        const user = await db('users').where({ id: req.userId }).first()
        if (user?.balance < 1) return res.status(400).json({ success: false, message: 'Please recharge your wallet.' });

        const pandit = await db('pandits').where({ id: panditId }).first()
        if (!pandit) return res.status(400).json({ success: false, message: 'Pandit not found.' });

        const continueOrder = await db('orders').where({ user_id: req.userId, pandit_id: panditId, type }).whereIn('status', ['continue', 'pending']).first()
        if (continueOrder) return res.status(400).json({ success: false, message: 'Please complete your ongoing order.' });

        // const order = await db('orders').where({ user_id: req.userId, pandit_id: panditId }).first()
        const orderId = ((parseInt(crypto.lib.WordArray.random(16).toString(), 16) % 1e6) + '').padStart(15, '0');
        let duration = Math.floor(Number(user?.balance) / Number(pandit?.charge));
        console.log("duration", duration);
        if (!Number.isFinite(duration)) {
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }

        if (duration < 5) {
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }
        const deduction = Number(duration) * Number(pandit?.charge)
        if (isNaN(deduction)) {
            return res.status(400).json({ success: false, message: 'Balance could not be NaN.' });
        }
        // console.log("last order", order);
        // if (!order) {
        //     //create 5 minute order
        //     deduction = (5 * pandit?.charge || 1);

        // } else {
        //     deduction = (5 * pandit?.charge || 1);
        if (user?.balance < deduction) return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        // deduction = (user?.balance - 50) / (pandit?.charge || 1)
        // }
        // if (user?.balance < deduction) return res.status(400).json({ success: false, message: 'Insufficient fund.' });


        const [saved] = await db('orders').insert({
            pandit_id: panditId,
            user_id: req.userId,
            order_id: orderId,
            status: "pending",
            rate: pandit?.charge || 1,
            duration,
            deduction,
            type,
            profile_id
        }).returning('*');
        console.log("order inserted", saved);

        console.log("start socket call");

        callEvent("emit_to_user_for_register", {
            key: `user_${req?.userId}`,
            payload: [{ ...saved, name: pandit?.name, profile: pandit?.profile }]
        });
        console.log(" socket end call");

        const token = pandit?.token || false;
        if (token) {
            console.log("start push notification");
            const messages = `new ${type} request from ${user?.name} (Rs ${pandit?.charge}/min).`
            const continueOrder = await db('panditnotifications').insert({ user_id: panditId, type: "order", message: messages })
            const message = {
                token,
                notification: {
                    title: messages,
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
            const response = await admin.messaging().send(message);
            console.log("push notification response", response);
            console.log("end push notification");
        }
        // socket.emit("emit_to_user_for_register", {
        //     key: `user_${req?.userId}`,
        //     payload: [{ ...saved, name: pandit?.name, profile: pandit?.profile }],
        // });
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
        const order = await db('orders as o')
            .distinctOn('o.pandit_id')
            .where('o.user_id', req.userId)
            .leftJoin('pandits as p', 'p.id', 'o.pandit_id')
            .leftJoin(
                db.raw(`
            (
              SELECT DISTINCT ON (order_id)
                order_id,
                lastmessage
              FROM chats
              ORDER BY order_id, id DESC
            ) c
          `),
                'c.order_id',
                'o.order_id'
            )

            // IMPORTANT: distinctOn column MUST be first in ORDER BY
            .orderBy([
                { column: 'o.pandit_id', order: 'asc' },
                {
                    column: db.raw(`
              CASE trim(o.status)
                WHEN 'continue' THEN 1
                WHEN 'pending' THEN 2
                WHEN 'completed' THEN 3
                ELSE 4
              END
            `),
                    order: 'asc'
                },
                { column: 'o.id', order: 'desc' } // latest order per pandit
            ])
            .select(
                'o.*',
                'p.name',
                'p.profile',
                'c.lastmessage'
            )
            .limit(limit)
            .offset(offset);
        const [{ count }] = await db('orders')
            .where('user_id', req.userId)
            .countDistinct('pandit_id as count');

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

function formatValue(value) {
    if (!value) return '';

    return value
        .toString()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function formatDOB(dob) {
    if (!dob) return '';
    return new Date(dob).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

async function acceptOrder(req, res) {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ success: false, message: 'Order id required.' });
        const order = await db('orders as o')
            .leftJoin('pandits as p', 'p.id', 'o.pandit_id')
            .where({
                'o.order_id': orderId,
                'o.user_id': req.userId,
                'o.status': 'pending',
                'o.is_accept': true
            })
            .select(
                'o.*',
                'p.name',
            )
            .first();
        if (!order) return res.status(400).json({ success: false, message: 'Order not accepted by pandit.' });

        const startTime = new Date()
        const endTime = new Date(Date.now() + `${order?.duration}` * 60 * 1000);
        await db('orders').where({ id: order?.id }).update({ status: "continue", start_time: startTime, end_time: endTime });

        if (order?.profile_id) {
            const profile = await db('userprofiles').where({ id: order?.profile_id }).first();

            let message = `Hello ${order?.name},\n Below are my details:
    Name: ${formatValue(profile?.name)} 
    Gender: ${formatValue(profile?.gender)} 
    DOB: ${formatDOB(profile?.dob)} 
    Birth Time: ${profile?.birth_time} 
    Birth Place: ${formatValue(profile?.birth_place)} 
    Marital Status: ${formatValue(profile?.marital_status)} \n`;
            if (profile?.occupation) {
                message += `    Occupation: ${formatValue(profile?.occupation)}\n`
            }
            if (profile?.topic_of_concern) {
                message += `    Concern Topic: ${formatValue(profile?.topic_of_concern)}\n`
            }
            if (profile?.topic_of_concern_other) {
                message += `    Other Concern: ${formatValue(profile?.topic_of_concern_other)}\n`
            }
            if (profile?.partner_name) {
                message += `    Partner Name: ${formatValue(profile?.partner_name)}`
            }
            if (profile?.partner_dob) {
                message += `    Partner DOB: ${formatDOB(profile?.partner_dob)}`
            }
            if (profile?.partner_dot) {
                message += `    Partner Birth Time: ${formatValue(profile?.partner_dot)}`
            }
            if (profile?.partner_place) {
                message += `    Partner Birth Place: ${formatValue(profile?.partner_place)} \n`
            }
            await db('chats').insert({
                sender_type: "user",
                sender_id: Number(req.userId),
                receiver_type: "pandit",
                order_id: orderId,
                receiver_id: Number(order?.pandit_id),
                lastmessage: message,
                message: message,
                status: "send",
                type: "text"
            });
        }
        // socket.emit("emit_to_user_for_pandit_accept", {
        //     toType: `user_${order?.userId}`,
        //     payload: order,
        // });

        callEvent("emit_to_user_chat_end_time", {
            key: `pandit_${order?.pandit_id}`,
            payload: { startTime, endTime, orderId }
        });

        return res.status(200).json({ success: true, message: 'Order accept Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function cancelOrder(req, res) {
    try {
        const { orderId } = req.body;
        if (!orderId) return res.status(400).json({ success: false, message: 'Order id required.' });
        const order = await db('orders').where({ order_id: orderId, user_id: req.userId, status: "pending" }).first();
        if (!order) return res.status(400).json({ success: false, message: 'You can not cancel this order.' });

        await db('orders').where({ id: order?.id }).update({ status: "cancel" });
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}
module.exports = { create, list, acceptOrder, cancelOrder };