const db = require('../db');
require('dotenv').config();
const serviceAccount = require('../config/astro-1e9f7-firebase-adminsdk-fbsvc-4f429f67a7.json');
const admin = require("firebase-admin");
const { callEvent } = require("../socket");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

async function create(req, res) {
    const { panditId, type, profile_id } = req.body;
    if (!panditId || !profile_id) {
        return res.status(400).json({ success: false, message: 'Missing params' });
    }
    console.log("create order req.body", req.body);
    try {
        const user = await db('users').where({ id: req.userId }).first()
        if (user?.balance < 1) return res.status(400).json({ success: false, message: 'Please recharge your wallet.' });

        const pandit = await db('pandits').where({ id: panditId }).first()
        if (!pandit) return res.status(400).json({ success: false, message: 'Pandit not found.' });

        const continueOrder = await db('orders').where({ user_id: req.userId, pandit_id: panditId }).whereIn('status', ['continue', 'pending']).first()
        if (continueOrder) return res.status(400).json({ success: false, message: 'Please complete your ongoing order.' });

        //check order deduction

        // const pandingOrder = await db('orders').where({ user_id: req.userId }).whereIn('status', ['continue', 'pending'])
        // let pendingDeduction = 0
        // if (pandingOrder?.length > 0) {
        //     pandingOrder.map(item => {
        //         pendingDeduction += Number(item.deduction)
        //     })
        // }

        // pendingDeduction = Number(user?.balance) - pendingDeduction

        // const order = await db('orders').where({ user_id: req.userId, pandit_id: panditId }).first()
        const orderId = `${new Date().getTime().toString()}${Math.floor(100000 + Math.random() * 900000).toString()}`;
        let duration = Math.floor(Number(Number(user?.balance)) / Number(pandit?.final_chat_call_rate));
        console.log("duration", duration);
        if (!Number.isFinite(duration)) {
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }

        if (duration < 5) {
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }
        const deduction = Number(duration) * Number(pandit?.final_chat_call_rate)
        if (isNaN(deduction)) {
            return res.status(400).json({ success: false, message: 'Balance could not be NaN.' });
        }
        // console.log("last order", order);
        // if (!order) {
        //     //create 5 minute order
        //     deduction = (5 * pandit?.chat_call_rate || 1);

        // } else {
        //     deduction = (5 * pandit?.chat_call_rate || 1);
        if (Number(user?.balance) < deduction) return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        // deduction = (user?.balance - 50) / (pandit?.chat_call_rate || 1)
        // }
        // if (user?.balance < deduction) return res.status(400).json({ success: false, message: 'Insufficient fund.' });


        const [saved] = await db('orders').insert({
            pandit_id: panditId,
            user_id: req.userId,
            order_id: orderId,
            status: "pending",
            rate: pandit?.final_chat_call_rate || 1,
            duration,
            deduction,
            type,
            profile_id
        }).returning('*');
        console.log("order inserted", saved);

        console.log("start socket call");

        const profile = await db('userprofiles').where({ id: Number(profile_id) }).first();

        callEvent("emit_to_user_for_register", {
            key: `user_${req?.userId}`,
            payload: [{ ...saved, name: pandit?.display_name, profile: pandit?.profile, profile_name: profile?.name }]
        });

        callEvent("emit_to_pending_order", {
            key: `pandit_${pandit?.id}`,
            payload: { pandit_id: pandit?.id }
        });
        console.log(" socket end call");

        const token = pandit?.token || false;
        if (token) {
            await sendNotification(token, user?.display_name, pandit?.final_chat_call_rate, panditId, type, orderId, pandit?.display_name, pandit?.profile)
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

async function sendNotification(token, username, chat_call_rate, panditId, type, orderId, panditName, profile) {
    try {
        if (token) {
            console.log("start push notification");
            const messages = `new ${type} request from ${username} (Rs ${chat_call_rate}/min).`
            const continueOrder = await db('panditnotifications').insert({ user_id: panditId, type: "order", message: messages })
            let message = {}
            // if (type == 'chat') {

            message = {
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

            };
            // } else {
            //     message = {
            //         token,

            //         // 🔥 ANDROID ONLY – HIGH PRIORITY
            //         android: {
            //             priority: "high",
            //         },

            //         // 🔥 DATA ONLY (NO notification block)
            //         data: {
            //             type: "incoming_call",
            //             userName: String(username),
            //             userId: String("userId"),
            //             channelName: String(orderId),
            //             agoraToken: String("agoraToken"),
            //             panditName,
            //             profile: profile == null ? "" : profile
            //         },
            //     };
            // }
            const response = await admin.messaging().send(message);
            console.log("push notification response", response);
            console.log("end push notification");
            return true;
        }
    } catch (e) {
        return true;
    }
}

async function list(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;

        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const { type } = req.query
        const filter = { 'o.user_id': req.userId, 'o.deleted_at': null }
        if (type) {
            filter['o.type'] = type
        }
        const offset = (page - 1) * limit;
        const order = await db('orders as o')
            .distinctOn('o.pandit_id')
            .where(filter)
            .andWhereNot('o.status', 'cancel')
            .leftJoin('pandits as p', 'p.id', 'o.pandit_id')
            .leftJoin(
                db.raw(`
            (
              SELECT DISTINCT ON (order_id)
                *
              FROM chats
              WHERE order_id IS NOT NULL AND deleted_at IS NULL AND is_system_generate IS NULL
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
                'p.display_name as name',
                'p.profile',
                'p.online',
                'p.tag',
                db.raw(`
                    CASE 
                        WHEN c.id IS NOT NULL THEN
                            json_build_object(
                                'id', c.id,
                                'message', c.message,
                                'sender_type', c.sender_type,
                                'sender_id', c.sender_id,
                                'receiver_type', c.receiver_type,
                                'receiver_id', c.receiver_id,
                                'type', c.type,
                                'status', c.status,
                                'created_at', c.created_at,
                                'receiver_delete', c.receiver_delete,
                                'sender_delete', c.sender_delete,
                                'is_system_generate', c.is_system_generate
                            )
                        ELSE NULL
                    END as last_message
                `)
            )
            .limit(limit)
            .offset(offset);
        const [{ count }] = await db('orders as o')
            .where(filter)
            .countDistinct('o.pandit_id as count');

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
                'p.display_name as name',
                'p.display_name',
                'p.final_chat_call_rate',
            )
            .first();
        if (!order) return res.status(400).json({ success: false, message: 'Order not accepted by pandit.' });

        const userDetail = await db('users').where({ id: req.userId }).first();

        let duration = Math.floor(Number(Number(userDetail?.balance)) / Number(order?.final_chat_call_rate));
        console.log("duration", duration);
        if (!Number.isFinite(duration)) {
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }

        if (duration < 5) {
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }
        const deduction = Number(duration) * Number(order?.final_chat_call_rate)
        if (isNaN(deduction)) {
            return res.status(400).json({ success: false, message: 'Balance could not be NaN.' });
        }

        const startTime = new Date()
        const endTime = new Date(Date.now() + `${duration}` * 60 * 1000);
        await db('orders').where({ id: order?.id }).update({ status: "continue", duration, deduction, start_time: startTime, end_time: endTime });
        await db('pandits').where({ id: order?.pandit_id }).update({ waiting_time: endTime });

        if (order?.profile_id && order.type == 'chat') {
            const profile = await db('userprofiles').where({ id: order?.profile_id }).first();

            let message = `Hello ${order?.display_name},\n Below are my details:
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

            let [saved] = await db('chats').insert({
                sender_type: "user",
                sender_id: Number(req.userId),
                receiver_type: "pandit",
                order_id: orderId,
                receiver_id: Number(order?.pandit_id),
                message: message,
                status: "send",
                type: "text"
            }).returning('*');
            callEvent("emit_to_user", {
                toType: "pandit",
                toId: order?.pandit_id,
                orderId: order?.order_id,
                payload: saved,
            });
            callEvent("emit_to_user", {
                toType: "user",
                toId: req.userId,
                orderId: order?.order_id,
                payload: saved,
            });

            [saved] = await db('chats').insert({
                sender_type: "user",
                sender_id: Number(req.userId),
                receiver_type: "pandit",
                order_id: orderId,
                receiver_id: Number(order?.pandit_id),
                message: "This is an automated message to confirm that chat has started.",
                status: "send",
                is_system_generate: true,
                type: "text"
            }).returning('*');

            callEvent("emit_to_user", {
                toType: "pandit",
                toId: order?.pandit_id,
                orderId: order?.order_id,
                payload: saved,
            });
            callEvent("emit_to_user", {
                toType: "user",
                toId: req.userId,
                orderId: order?.order_id,
                payload: saved,
            });
        }
        // socket.emit("emit_to_user_for_pandit_accept", {
        //     toType: `user_${order?.userId}`,
        //     payload: order,
        // });
        if (order.type == 'chat') {
            callEvent("emit_to_user_chat_end_time", {
                key: `pandit_${order?.pandit_id}`,
                payload: { startTime, endTime, orderId }
            });
        }
        if (order.type == 'call') {
            console.log("emit_to_user_call_end_time call start",);
            callEvent("emit_to_user_call_end_time", {
                key: `pandit_${order?.pandit_id}`,
                payload: { startTime, endTime, orderId }
            });
            console.log("emit_to_user_call_end_time call end",);

        }

        callEvent("emit_to_pending_order", {
            key: `pandit_${order?.pandit_id}`,
            payload: { pandit_id: order?.pandit_id }
        });

        return res.status(200).json({ success: true, data: { startTime, endTime, orderId }, message: 'Order accept Successfully' });
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

        callEvent("emit_to_pending_order", {
            key: `pandit_${order?.pandit_id}`,
            payload: { pandit_id: order?.pandit_id }
        });

        if (order.type == 'chat') {
            callEvent("emit_to_chat_rejected", {
                key: `pandit_${order?.pandit_id}`,
                order_id: order?.order_id,
            });
        } else {
            callEvent("emit_to_call_rejected", {
                key: `pandit_${order?.pandit_id}`,
                order_id: order?.order_id,
            });
        }
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteOrder(req, res) {
    try {
        const { order_id } = req.query;
        if (!order_id) return res.status(400).json({ success: false, message: 'Order id required.' });
        const order = await db('orders').where({ order_id, user_id: req.userId }).first();
        if (!order) return res.status(400).json({ success: false, message: 'You can not delete this order.' });

        await db('orders').where({ id: order?.id }).update({ deleted_at: new Date() });
        await db('chats').where({ order_id }).update({ deleted_at: new Date() });
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendGift(req, res) {
    try {
        const { name, pandit_id, amount, qty } = req.body;
        if (!pandit_id || !amount || !qty) return res.status(400).json({ success: false, message: 'Missing params.' });
        if (isNaN(qty)) return res.status(400).json({ success: false, message: 'Missing params.' });
        const pandit = await db('pandits').where({ id: pandit_id }).first();
        const user = await db('users').where({ id: req.userId }).first();
        const order = await db('orders').where({ user_id: req.userId, status: "continue" }).first();
        if (order) return res.status(400).json({ success: false, message: 'please finish your continue order.' });

        const final = qty * amount
        if (user?.balance < Number(final)) return res.status(400).json({ success: false, message: 'Insufficient balance.' });
        if (!pandit) return res.status(400).json({ success: false, message: 'Pandit not found.' });
        if (isNaN(final)) return res.status(400).json({ success: false, message: 'Invalid amount.' });

        const panditAmount = (Number(final) * Number(pandit?.gift_share)) / 100
        await db('pandits').where({ id: pandit.id }).increment({ balance: Number(panditAmount) });
        await db('users').where({ id: user?.id }).increment({ balance: -Number(final) });
        const newBalance = Number(user.balance) - Number(final)
        const pandit_new_balance = Number(pandit.balance) + Number(panditAmount)
        await db('balancelogs').insert({ pandit_old_balance: Number(pandit?.balance), pandit_new_balance, user_old_balance: Number(user.balance), user_new_balance: Number(newBalance), user_id: req.userId, message: `send gift to ${pandit?.display_name} (${name}) - ${qty}`, pandit_id: pandit?.id, pandit_message: `receive gift from ${user?.name} (${name}) - ${qty}`, pandit_amount: panditAmount, amount: - final });
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function generateCallToken(req, res) {
    const { order_id, pandit_id } = req.body;
    if (!order_id || !pandit_id) {
        return res.status(400).json({ error: 'Missing params.' });
    }
    callEvent("emit_to_call_request", {
        key: `pandit_${pandit_id}`,
        payload: [{ order_id }]
    });
    return res.status(200).json({ success: true, message: 'Call requested Successfully' });
}

async function callReject(req, res) {
    const { order_id, pandit_id } = req.body;
    if (!order_id || !pandit_id) {
        return res.status(400).json({ error: 'Missing params.' });
    }
    callEvent("emit_to_call_rejected", {
        key: `pandit_${pandit_id}`,
        order_id,
    });
    return res.status(200).json({ success: true, message: 'Call requested Successfully' });
}
module.exports = { create, list, acceptOrder, cancelOrder, deleteOrder, sendGift, generateCallToken, callReject };