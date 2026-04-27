const db = require('../db');
require('dotenv').config();
const admin = require('../config/firebase');
const path = require('path');
const logger = require('log4js').getLogger(path.parse(__filename).name);
const axios = require('axios');

const { callEvent } = require("../socket");
const { channelLeave } = require('./agoraController');
const { replaceTemplate } = require('../utils/replaceTemplate');
const { readJoinedUserIds, emitLiveChatMessage } = require('./liveStreamingController');

async function sendAutoMessage(profile, userId, orderId, panditId) {
    const panditIdNum = panditId != null && panditId !== '' ? Number(panditId) : null;
    let message = `Hi,\n Below are my details:
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
        sender_id: Number(userId),
        receiver_type: "pandit",
        order_id: orderId,
        receiver_id: panditIdNum,
        message: message,
        status: "send",
        type: "text"
    }).returning('*');
    if (panditIdNum != null) {
        callEvent("emit_to_user", {
            toType: "pandit",
            toId: panditIdNum,
            orderId: orderId,
            payload: saved,
        });
    }

    callEvent("emit_to_user", {
        toType: "user",
        toId: userId,
        orderId: orderId,
        payload: saved,
    });

    [saved] = await db('chats').insert({
        sender_type: "pandit",
        sender_id: panditIdNum,
        receiver_type: "user",
        order_id: orderId,
        receiver_id: Number(userId),
        message: "Welcome to AstroGuruji!",
        status: "send",
        is_system_generate: true,
        type: "text"
    }).returning('*');
    if (panditIdNum != null) {
        callEvent("emit_to_user", { toType: "pandit", toId: panditIdNum, orderId, payload: saved });
    }
    callEvent("emit_to_user", { toType: "user", toId: userId, orderId, payload: saved });

    [saved] = await db('chats').insert({
        sender_type: "pandit",
        sender_id: panditIdNum,
        receiver_type: "user",
        order_id: orderId,
        receiver_id: Number(userId),
        message: "Astrologer will join within 10 seconds",
        status: "send",
        is_system_generate: true,
        type: "text"
    }).returning('*');
    if (panditIdNum != null) {
        callEvent("emit_to_user", { toType: "pandit", toId: panditIdNum, orderId, payload: saved });
    }
    callEvent("emit_to_user", { toType: "user", toId: userId, orderId, payload: saved });

    [saved] = await db('chats').insert({
        sender_type: "pandit",
        sender_id: panditIdNum,
        receiver_type: "user",
        order_id: orderId,
        receiver_id: Number(userId),
        message: "Please share your question in the meanwhile",
        status: "send",
        is_system_generate: true,
        type: "text"
    }).returning('*');
    if (panditIdNum != null) {
        callEvent("emit_to_user", { toType: "pandit", toId: panditIdNum, orderId, payload: saved });
    }
    callEvent("emit_to_user", { toType: "user", toId: userId, orderId, payload: saved });
}

async function create(req, res) {
    const { panditId, type, profile_id } = req.body;
    logger.info('order_create', { userId: req.userId, panditId, type, profile_id });
    if (!panditId || !profile_id) {
        logger.info('order_create fail', { userId: req.userId, message: 'Missing params' });
        return res.status(400).json({ success: false, message: 'Missing params' });
    }
    // console.log("create order req.body", req.body);
    try {
        const user = await db('users').where({ id: req.userId }).first()

        const pandit = await db('pandits').where({ id: panditId }).first()
        if (!pandit) {
            logger.info('order_create fail', { userId: req.userId, panditId, message: 'Pandit not found.' });
            return res.status(400).json({ success: false, message: 'Pandit not found.' });
        }

        // const continueOrder = await db('orders').where({ user_id: req.userId, pandit_id: panditId }).whereIn('status', ['continue', 'pending']).first()
        const continueOrder = await db('orders').where({ user_id: req.userId }).whereIn('status', ['continue', 'pending']).first()
        if (continueOrder?.status == 'continue') {
            logger.info('order_create fail', { userId: req.userId, message: `Please complete your ongoing ${type}.` });
            return res.status(400).json({ success: false, message: `Please complete your ongoing ${type}.` });
        }
        if (continueOrder?.status == 'pending') {
            logger.info('order_create fail', { userId: req.userId, message: `Please reject your pending ${type}.` });
            return res.status(400).json({ success: false, message: `Please reject your pending ${type}.` });
        }

        const [{ count }] = await db('orders')
            .count('* as count')
            .where({ user_id: req.userId })
            .whereIn('status', ['continue', 'completed', 'pending']);
        let duration = Math.floor(Number(Number(user?.balance)) / Number(pandit?.final_chat_call_rate));
        let deduction = Number(duration) * Number(pandit?.final_chat_call_rate)
        let rate = pandit?.final_chat_call_rate;
        if (count == 0) {
            const settings = await db('settings').first();
            duration = Number(settings?.free_chat_minutes) || 0;
            deduction = 0;
            rate = settings?.free_chat_amount_per_minute || 1;
        } else {
            if (user?.balance < 1) {
                logger.info('order_create fail', { userId: req.userId, message: 'Please recharge your wallet.' });
                return res.status(400).json({ success: false, message: 'Please recharge your wallet.' });
            }
            if (duration < 5) {
                logger.info('order_create fail', { userId: req.userId, message: 'Min. 5 min balance required.' });
                return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
            }
            if (Number(user?.balance) < deduction) {
                logger.info('order_create fail', { userId: req.userId, message: 'Min. 5 min balance required.' });
                return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
            }
        }
        // const order = await db('orders').where({ user_id: req.userId, pandit_id: panditId }).first()
        const orderId = `${new Date().getTime().toString()}${Math.floor(100000 + Math.random() * 900000).toString()}`;
        // console.log("duration", duration);
        if (!Number.isFinite(duration)) {
            logger.info('order_create fail', { userId: req.userId, message: 'Min. 5 min balance required.' });
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }

        if (isNaN(deduction)) {
            logger.info('order_create fail', { userId: req.userId, message: 'Balance could not be NaN.' });
            return res.status(400).json({ success: false, message: 'Balance could not be NaN.' });
        }
        // console.log("last order", order);
        // if (!order) {
        //     //create 5 minute order
        //     deduction = (5 * pandit?.chat_call_rate || 1);

        // } else {
        //     deduction = (5 * pandit?.chat_call_rate || 1);
        // deduction = (user?.balance - 50) / (pandit?.chat_call_rate || 1)
        // }
        // if (user?.balance < deduction) return res.status(400).json({ success: false, message: 'Insufficient fund.' });
        const ins = {
            pandit_id: panditId,
            user_id: req.userId,
            order_id: orderId,
            status: "pending",
            rate,
            duration,
            deduction,
            type,
            profile_id,
            is_free: false
        }
        const upd = { is_free_order: "paid" }
        if (count == 0) {
            ins.is_free = true
            upd.is_free_order = "free"
        }
        await db('users').where({ id: Number(req.userId) }).update(upd);

        const [saved] = await db('orders').insert(ins).returning('*');
        // console.log("order inserted", saved);

        // console.log("start socket call");
        const profile = await db('userprofiles').where({ id: Number(profile_id) }).first();

        if (count == 0) {
            sendAutoMessage(profile, req.userId, orderId, panditId);
        }
        callEvent("emit_to_user_for_register", {
            key: `user_${req?.userId}`,
            payload: [{ ...saved, name: pandit?.display_name, profile: pandit?.profile, profile_name: profile?.name }]
        });

        callEvent("emit_to_pending_order", {
            key: `pandit_${pandit?.id}`,
            payload: { pandit_id: pandit?.id }
        });
        // console.log(" socket end call");

        const token = pandit?.token || false;
        console.log("token", token);
        if (token) {
            const waiting_time = pandit?.waiting_time == null ? true : false

            const resposne = await sendNotification(token, user?.name, pandit?.final_chat_call_rate, panditId, type, waiting_time)
            logger.info('resposne', resposne)
        }
        // socket.emit("emit_to_user_for_register", {
        //     key: `user_${req?.userId}`,
        //     payload: [{ ...saved, name: pandit?.name, profile: pandit?.profile }],
        // });
        // axios({
        //     method: 'post',
        //     url: process.env.ADMIN_CALLBACK_URL,
        //     data: {
        //         name: pandit?.display_name,
        //         id: pandit?.id,
        //         mobile: pandit?.mobile,
        //         order_id: orderId,
        //         type: "astrologer"
        //     }
        // });
        logger.info('order_create success', { userId: req.userId, orderId, panditId, type });
        return res.status(200).json({ success: true, data: { orderId }, message: 'Order create Successfully' });
    } catch (err) {
        logger.error('order_create error', { userId: req.userId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function createFreeChat(req, res) {
    const { profile_id, type } = req.body;
    logger.info('order_createFreeChat', { userId: req.userId, profile_id, type });
    if (!profile_id || !type) {
        logger.info('order_createFreeChat fail', { userId: req.userId, message: 'Missing params' });
        return res.status(400).json({ success: false, message: 'Missing params' });
    }
    try {
        const [user, countRows, settings, profile] = await Promise.all([
            db('users').where({ id: req.userId }).first(),
            db('orders').count('* as count').where({ user_id: req.userId }).whereIn('status', ['continue', 'completed', 'pending']),
            db('settings').first(),
            db('userprofiles').where({ id: Number(profile_id) }).first(),
        ]);
        const count = Number(countRows?.[0]?.count ?? 0);
        if (count > 0) {
            logger.info('order_createFreeChat fail', { userId: req.userId, message: 'Your free chat already completed.' });
            return res.status(400).json({ success: false, message: 'Your free chat already completed.' });
        }

        const limit = Number(settings?.free_chat_max_pandit_request) || 30;

        let languages = user?.language ? JSON.parse(user.language) : null;
        if (languages?.length > 0) {
            languages = languages.map(s => s?.trim()).filter(Boolean).map(s => `%${s}%`);
        }

        const applyLanguage = (q) => {
            if (languages?.length) q.andWhereRaw(`languages ILIKE ANY (ARRAY[${languages.map(() => '?').join(',')}])`, languages);
            return q;
        };

        let panditsQuery = db('pandits').select('id').where({ unlimited_free_calls_chats: true, chat: true }).whereNull('waiting_time');
        applyLanguage(panditsQuery);
        let pandits = await panditsQuery.orderByRaw('RANDOM()').limit(limit);
        if (pandits.length < limit) {
            const excludeIds = pandits.map((p) => p.id);
            let more2Query = db('pandits').select('id').whereNull('waiting_time').where({ chat: true }).whereNotIn('id', excludeIds.length ? excludeIds : [0]);
            // applyLanguage(more2Query);
            const more2 = await more2Query.orderByRaw('RANDOM()').limit(limit - pandits.length);
            pandits = [...pandits, ...more2];
        }
        if (pandits.length < limit) {
            const excludeIds = pandits.map((p) => p.id);
            let more1Query = db('pandits').select('id').where({ unlimited_free_calls_chats: true, chat: true }).whereNotIn('id', excludeIds.length ? excludeIds : [0]);
            // applyLanguage(more1Query);
            const more1 = await more1Query.orderByRaw('RANDOM()').limit(limit - pandits.length);
            pandits = [...pandits, ...more1];
        }
        if (pandits.length < limit) {
            const excludeIds = pandits.map((p) => p.id);
            let more3Query = db('pandits').select('id').where({ chat: true }).whereNotIn('id', excludeIds.length ? excludeIds : [0]);
            // applyLanguage(more3Query);
            const more3 = await more3Query.orderByRaw('RANDOM()').limit(limit - pandits.length);
            pandits = [...pandits, ...more3];
        }

        const orderId = `${new Date().getTime().toString()}${Math.floor(100000 + Math.random() * 900000).toString()}`;

        let requestedPanditIds = [...new Set((pandits || []).map((p) => p.id))];
        logger.info("query mathi requestedPanditIds", { requestedPanditIds, orderId });
        if (requestedPanditIds.length === 0) {
            logger.info('order_createFreeChat fail', { userId: req.userId, message: 'No pandit available.' });
            return res.status(400).json({ success: false, message: 'No pandit available.' });
        }

        const continueOrder = await db('orders').where({ status: "continue" }).whereIn('pandit_id', requestedPanditIds).select('pandit_id');
        if (continueOrder?.length) {
            const busyPanditIds = new Set(continueOrder.map((item) => item.pandit_id));
            requestedPanditIds = requestedPanditIds.filter((id) => !busyPanditIds.has(id));
        }
        if (requestedPanditIds.length === 0) {
            logger.info('order_createFreeChat fail', { userId: req.userId, message: 'No pandit available.' });
            return res.status(400).json({ success: false, message: 'No pandit available.' });
        }

        logger.info("final requestedPanditIds count", { requestedPanditIds, orderId });

        const duration = Number(settings?.free_chat_minutes) || 0;
        if (!duration || duration < 1) {
            logger.info('order_createFreeChat fail', { userId: req.userId, message: 'Free chat minutes not configured.' });
            return res.status(400).json({ success: false, message: 'Free chat minutes not configured.' });
        }

        const [saved] = await db('orders').insert({
            user_id: req.userId,
            order_id: orderId,
            status: 'pending',
            rate: settings?.free_chat_amount_per_minute,
            duration,
            deduction: 0,
            type: "chat",
            profile_id,
            is_free: true,
            requested_pandits: JSON.stringify(requestedPanditIds),
        }).returning('*');

        const panditRecords = await db('pandits').whereIn('id', requestedPanditIds).select('id', 'token', 'waiting_time', 'display_name', 'profile', 'final_chat_call_rate');

        requestedPanditIds.forEach((panditId) => {
            callEvent('emit_to_pending_order', {
                key: `pandit_${panditId}`,
                payload: { pandit_id: panditId, order_id: orderId, requested_pandits: requestedPanditIds },
            });
        });

        const notificationPromises = (panditRecords || [])
            .filter((p) => p?.token)
            .map((p) => sendNotification(p.token, user?.name, settings?.free_chat_amount_per_minute, p.id, type, p.waiting_time == null, true));
        if (notificationPromises.length) await Promise.all(notificationPromises);

        sendAutoMessage(profile, req.userId, orderId);
        logger.info('order_createFreeChat success', { userId: req.userId, orderId });
        return res.status(200).json({ success: true, data: { orderId, ...saved }, message: 'Free chat order created successfully.' });
    } catch (err) {
        logger.error('order_createFreeChat error', { userId: req.userId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendNotification(token, username, chat_call_rate, panditId, type, is_available = false, is_free = false) {
    logger.info("is_available", is_available);
    try {
        const filter = {
            type: 'pandit', status: 'active'
        }
        if (type == 'chat' && !is_free) {
            filter.message_type = 'Chat Request'
        }
        if (type == 'chat' && is_free) {
            filter.message_type = 'Free Chat Request'
        }
        if (type == 'call' && !is_free) {
            filter.message_type = 'Call Request'
        }
        if (type == 'call' && is_free) {
            filter.message_type = 'Free Call Request'
        }
        const template = await db('templates').where(filter).first();
        logger.info("template", template);
        if (!template) return true;

        const messages = replaceTemplate(template?.title, {
            user_name: username,
            pandit_rate: chat_call_rate
        })
        logger.info("messages", messages);
        if (token) {
            // console.log("start push notification");
            // const messages = `new ${type} request from ${username} (Rs ${chat_call_rate}/min).`
            // const continueOrder = await db('panditnotifications').insert({ user_id: panditId, type: "order", message: messages })
            let message = {}
            // if (type == 'chat') {
            // const [{ count: panditCountRow }] = await db('orders')
            //     .where({ pandit_id: panditId })
            //     .whereIn('status', ['continue'])
            //     .count('* as count');
            // const panditCount = Number(panditCountRow) || 0;
            // is_available = false
            // console.log("panditCount", panditCount);
            // if (panditCount == 0) {
            //     is_available = true
            // }
            // if (panditCount > 0) {
            //     message = {
            //         token,
            //         notification: {
            //             title: messages,
            //         },

            //         // 🔔 Android
            //         android: {
            //             notification: {
            //                 sound: 'default'
            //             }
            //         },

            //         // 🔔 iOS
            //         apns: {
            //             payload: {
            //                 aps: {
            //                     sound: 'default'
            //                 }
            //             }
            //         },

            //         // 🔔 Web Browser
            //         webpush: {
            //             notification: {
            //                 // icon: '/icon.png',
            //                 requireInteraction: true
            //                 // NOTE: Browsers play default sound automatically
            //             }
            //         },

            //         data: {
            //             is_available: String(is_available),
            //         }
            //     };
            // }
            // else {
            logger.info("inside else");

            message = {
                token, // This must be the VoIP Token, not the standard FCM token
                // notification: {
                //     title: messages,
                // },
                android: {
                    priority: "high",
                },
                // Add this for iOS
                apns: {
                    headers: {
                        "apns-priority": "10",
                        "apns-push-type": "voip", // CRITICAL: This tells iOS it's a call
                        "apns-topic": "com.your.bundleid.voip" // Must end in .voip
                    },
                    payload: {
                        aps: {
                            "content-available": 1
                        },
                        // Your custom data
                        type: type == 'chat' ? "incoming_chat" : "incoming_call",
                        is_available: String(is_available),
                        title: messages,
                        // ... other data
                    }
                },
                data: {
                    type: type == 'chat' ? "incoming_chat" : "incoming_call",
                    is_available: String(is_available),
                    title: messages,
                    order_id: "123",
                    userId: "userId"
                },
            };
            // }
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

            logger.info("message", message);
            const response = await admin.messaging().send(message);
            console.log("push notification response", response);
            console.log("end push notification");
            return true;
        }
    } catch (e) {
        logger.error("sendNotification error", e);
        return true;
    }
}

/** DISTINCT ON sort key — same as CASE in ORDER BY */
const ORDER_LIST_STATUS_RANK_SQL = `
  CASE trim(o.status)
    WHEN 'continue' THEN 1
    WHEN 'pending' THEN 2
    WHEN 'completed' THEN 3
    ELSE 4
  END
`;

const ORDER_LIST_MAX_LIMIT = 100;

/**
 * Order list: one row per pandit, last chat per order.
 * Perf: subquery DISTINCT ON first (no full chats denormalized join on every order row);
 * LATERAL limits chat work to final page rows; count + list in parallel.
 * DB: indexes on orders (user_id, pandit_id, …) and chats (order_id, id) help a lot — add in your DB if missing.
 * Optional: ?skip_last_message=1 — faster list if client does not need last_message JSON.
 */
async function list(req, res) {
    const { type } = req.query || {};
    const skipLastMessage = String(req.query.skip_last_message || '') === '1';
    logger.info('order_list', { userId: req.userId, type, skipLastMessage });
    try {
        let page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 20;

        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        if (limit > ORDER_LIST_MAX_LIMIT) limit = ORDER_LIST_MAX_LIMIT;

        const filter = { 'o.user_id': req.userId, 'o.deleted_at': null };
        if (type) {
            filter['o.type'] = type;
        }
        const offset = (page - 1) * limit;

        const statusRank = db.raw(ORDER_LIST_STATUS_RANK_SQL);

        const oneOrderPerPandit = db('orders as o')
            .select('o.*')
            .where(filter)
            .whereNot('o.status', 'cancel')
            .distinctOn('o.pandit_id')
            .orderBy([
                { column: 'o.pandit_id', order: 'asc' },
                { column: statusRank, order: 'asc' },
                { column: 'o.id', order: 'desc' },
            ]);

        let listQb = db.from(oneOrderPerPandit.as('o')).leftJoin('pandits as p', 'p.id', 'o.pandit_id');

        if (!skipLastMessage) {
            listQb = listQb.joinRaw(
                `LEFT JOIN LATERAL (
                  SELECT c.id, c.message, c.sender_type, c.sender_id, c.receiver_type, c.receiver_id,
                         c.type, c.status, c.created_at, c.receiver_delete, c.sender_delete, c.is_system_generate
                  FROM chats c
                  WHERE c.order_id = o.order_id
                    AND c.deleted_at IS NULL
                    AND c.is_system_generate IS NULL
                  ORDER BY c.id DESC
                  LIMIT 1
                ) AS c ON true`
            );
        }

        const lastMessageSelect = skipLastMessage
            ? db.raw('NULL::json as last_message')
            : db.raw(`
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
            `);

        const listPromise = listQb
            .clone()
            .select('o.*', 'p.display_name as name', 'p.profile', 'p.online', 'p.tag', lastMessageSelect)
            .orderBy([
                { column: 'o.pandit_id', order: 'asc' },
                { column: db.raw(ORDER_LIST_STATUS_RANK_SQL), order: 'asc' },
                { column: 'o.id', order: 'desc' },
            ])
            .limit(limit)
            .offset(offset);

        const countPromise = db('orders as o')
            .where(filter)
            .whereNot('o.status', 'cancel')
            .countDistinct('o.pandit_id as count');

        const [order, countRows] = await Promise.all([listPromise, countPromise]);

        const count = countRows[0]?.count ?? 0;
        const total = parseInt(count, 10);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: order,
        };
        logger.info('order_list success', { userId: req.userId });
        return res.status(200).json({ success: true, data: response, message: 'Order list Successfully' });
    } catch (err) {
        logger.error('order_list error', { userId: req.userId, err: err?.message });
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
    const { orderId } = req.body || {};
    logger.info('order_acceptOrder', { userId: req.userId, orderId });
    try {
        if (!orderId) {
            logger.info('order_acceptOrder fail', { userId: req.userId, message: 'Order id required.' });
            return res.status(400).json({ success: false, message: 'Order id required.' });
        }
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
        if (!order) {
            logger.info('order_acceptOrder fail', { userId: req.userId, orderId, message: 'Order not accepted by pandit.' });
            return res.status(400).json({ success: false, message: 'Order not accepted by pandit.' });
        }

        const userDetail = await db('users').where({ id: req.userId }).first();

        let duration;
        let deduction;
        if (order.is_free) {
            const settings = await db('settings').first();
            duration = Number(settings?.free_chat_minutes) || 0;
            deduction = 0;
        } else {
            duration = Math.floor(Number(Number(userDetail?.balance)) / Number(order?.final_chat_call_rate));
            // console.log("duration", duration);
            if (!Number.isFinite(duration)) {
                logger.info('order_acceptOrder fail', { userId: req.userId, orderId, message: 'Min. 5 min balance required.' });
                return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
            }

            if (duration < 5) {
                logger.info('order_acceptOrder fail', { userId: req.userId, orderId, message: 'Min. 5 min balance required.' });
                return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
            }
            deduction = Number(duration) * Number(order?.final_chat_call_rate)
            if (isNaN(deduction)) {
                logger.info('order_acceptOrder fail', { userId: req.userId, orderId, message: 'Balance could not be NaN.' });
                return res.status(400).json({ success: false, message: 'Balance could not be NaN.' });
            }
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
                payload: { startTime, endTime, orderId, user_id: order?.user_id }
            });
        }
        if (order.type == 'call') {
            // console.log("emit_to_user_call_end_time call start",);
            callEvent("emit_to_user_call_end_time", {
                key: `pandit_${order?.pandit_id}`,
                payload: { startTime, endTime, orderId }
            });
            // console.log("emit_to_user_call_end_time call end",);

        }

        callEvent("emit_to_pending_order", {
            key: `pandit_${order?.pandit_id}`,
            payload: { pandit_id: order?.pandit_id }
        });

        logger.info('order_acceptOrder success', { userId: req.userId, orderId });
        return res.status(200).json({ success: true, data: { startTime, endTime, orderId }, message: 'Order accept Successfully' });
    } catch (err) {
        logger.error('order_acceptOrder error', { userId: req.userId, orderId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function cancelOrder(req, res) {
    const { orderId } = req.body || {};
    logger.info('order_cancelOrder', { userId: req.userId, orderId });
    try {
        if (!orderId) {
            logger.info('order_cancelOrder fail', { userId: req.userId, message: 'Order id required.' });
            return res.status(400).json({ success: false, message: 'Order id required.' });
        }
        const order = await db('orders').where({ order_id: orderId, user_id: req.userId, status: "pending" }).first();
        if (!order) {
            logger.info('order_cancelOrder fail', { userId: req.userId, orderId, message: 'You can not cancel this order.' });
            return res.status(400).json({ success: false, message: 'You can not cancel this order.' });
        }
        const upd = { order_action: 'user' }
        let status = 'cancel';
        if (!order?.is_accept) {
            upd.canceled_at = new Date()
        }
        if (order?.is_accept) {
            status = 'rejected'
        }
        upd.status = status
        await db('orders').where({ id: order?.id }).update(upd);

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
        logger.info('order_cancelOrder success', { userId: req.userId, orderId });
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        logger.error('order_cancelOrder error', { userId: req.userId, orderId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteOrder(req, res) {
    const { order_id } = req.query || {};
    logger.info('order_deleteOrder', { userId: req.userId, order_id });
    try {
        if (!order_id) {
            logger.info('order_deleteOrder fail', { userId: req.userId, message: 'Order id required.' });
            return res.status(400).json({ success: false, message: 'Order id required.' });
        }
        const order = await db('orders').where({ order_id, user_id: req.userId }).first();
        if (!order) {
            logger.info('order_deleteOrder fail', { userId: req.userId, order_id, message: 'You can not delete this order.' });
            return res.status(400).json({ success: false, message: 'You can not delete this order.' });
        }

        await db('orders').where({ id: order?.id }).update({ deleted_at: new Date() });
        await db('chats').where({ order_id }).update({ deleted_at: new Date() });
        logger.info('order_deleteOrder success', { userId: req.userId, order_id });
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        logger.error('order_deleteOrder error', { userId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendGift(req, res) {
    const { name, pandit_id, amount, qty, is_live } = req.body || {};
    logger.info('order_sendGift', { userId: req.userId, pandit_id, amount, qty });
    try {
        if (!pandit_id || !amount || !qty) {
            logger.info('order_sendGift fail', { userId: req.userId, message: 'Missing params.' });
            return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        if (isNaN(qty)) {
            logger.info('order_sendGift fail', { userId: req.userId, message: 'Missing params.' });
            return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        const pandit = await db('pandits').where({ id: pandit_id }).first();
        const user = await db('users').where({ id: req.userId }).first();
        const order = await db('orders').where({ user_id: req.userId, status: "continue" }).first();
        if (order) {
            logger.info('order_sendGift fail', { userId: req.userId, message: 'please finish your continue order.' });
            return res.status(400).json({ success: false, message: 'please finish your continue order.' });
        }

        const final = qty * amount
        if (user?.balance < Number(final)) {
            logger.info('order_sendGift fail', { userId: req.userId, message: 'Insufficient balance.' });
            return res.status(400).json({ success: false, message: 'Insufficient balance.' });
        }
        if (!pandit) {
            logger.info('order_sendGift fail', { userId: req.userId, pandit_id, message: 'Pandit not found.' });
            return res.status(400).json({ success: false, message: 'Pandit not found.' });
        }
        if (isNaN(final)) {
            logger.info('order_sendGift fail', { userId: req.userId, message: 'Invalid amount.' });
            return res.status(400).json({ success: false, message: 'Invalid amount.' });
        }

        const panditAmount = (Number(final) * Number(pandit?.gift_share)) / 100
        await db('pandits').where({ id: pandit.id }).increment({ balance: Number(panditAmount) });
        await db('users').where({ id: user?.id }).increment({ balance: -Number(final) });
        const newBalance = Number(user.balance) - Number(final)
        const pandit_new_balance = Number(pandit.balance) + Number(panditAmount)
        await db('balancelogs').insert({ pandit_old_balance: Number(pandit?.balance), pandit_new_balance, user_old_balance: Number(user.balance), user_new_balance: Number(newBalance), user_id: req.userId, message: `Send gift to ${pandit?.display_name} (${name}) - ${qty}`, pandit_id: pandit?.id, pandit_message: `Receive gift from ${user?.name} (${name}) - ${qty}`, pandit_amount: panditAmount, amount: - final });
        logger.info('order_sendGift success', { userId: req.userId, pandit_id, amount: final });

        if (is_live) {
            callEvent("emit_to_live_gift_send", {
                key: `pandit_${pandit_id}`,
                payload: { name, user_id: req.userId, username: user?.name, avatar: user?.avatar, profile: user?.profile, amount, qty, is_live },
            });

            const channel = await db('live_streams').select('channel_id').where({ pandit_id: Number(pandit.id), status: "live" }).first();
            const payload = {
                username: user?.name,
                profile: user?.profile,
                avatar: user?.avatar,
                gift_name: name,
                amount,
                channel_id: channel?.channel_id
            }
            if (channel?.channel_id) {
                const joined_user_ids = await readJoinedUserIds(channel?.channel_id);

                const base = payload;
                for (const user_id of joined_user_ids) {
                    const uid = user_id != null && Number.isFinite(Number(user_id)) ? Number(user_id) : null;
                    if (uid != null) {
                        callEvent('emit_to_user_send_gift', { key: `user_${uid}`, payload: base });
                    }
                }
            }
        }
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        logger.error('order_sendGift error', { userId: req.userId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function generateCallToken(req, res) {
    const { order_id, pandit_id } = req.body || {};
    logger.info('order_generateCallToken', { userId: req.userId, order_id, pandit_id });
    if (!order_id || !pandit_id) {
        logger.info('order_generateCallToken fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ error: 'Missing params.' });
    }
    callEvent("emit_to_call_request", {
        key: `pandit_${pandit_id}`,
        payload: [{ order_id }]
    });
    logger.info('order_generateCallToken success', { userId: req.userId, order_id, pandit_id });
    return res.status(200).json({ success: true, message: 'Call requested Successfully' });
}

async function callReject(req, res) {
    const { order_id, pandit_id } = req.body || {};
    logger.info('order_callReject', { userId: req.userId, order_id, pandit_id });
    if (!order_id || !pandit_id) {
        logger.info('order_callReject fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ error: 'Missing params.' });
    }
    const order = await db('orders').where({ order_id, user_id: req.userId, }).first();
    if (!order) {
        logger.info('order_callReject fail', { userId: req.userId, order_id, message: 'You can not cancel this order.' });
        return res.status(400).json({ success: false, message: 'You can not cancel this order.' });
    }
    if (order?.type == "call" && order?.status == "pending") {
        await db('orders').where({ id: order?.id }).update({ status: "cancel", order_action: "user" });
    }
    callEvent("emit_to_call_rejected", {
        key: `pandit_${pandit_id}`,
        order_id,
    });
    logger.info('order_callReject success', { userId: req.userId, order_id, pandit_id });
    return res.status(200).json({ success: true, message: 'Call requested Successfully' });
}


async function callEnd(req, res) {
    const { order_id } = req.body || {};
    logger.info('order_callEnd', { panditId: req.userId, order_id });
    try {
        if (!order_id) {
            logger.info('order_callEnd fail', { panditId: req.userId, message: 'Order id required.' });
            return res.status(400).json({ success: false, message: 'Order id required.' });
        }
        const order = await db('orders').where({ order_id, pandit_id: req.userId }).first();
        if (!order) {
            logger.info('order_callEnd fail', { panditId: req.userId, order_id, message: 'Order not found.' });
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }

        const dd = await channelLeave(order_id)
        logger.info('order_callEnd success', { panditId: req.userId, order_id });
        return res.status(200).json({
            success: true, data: null, message: 'Call ended Successfully'
        });
    } catch (err) {
        logger.error('order_callEnd error', { panditId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { create, createFreeChat, list, acceptOrder, cancelOrder, deleteOrder, sendGift, generateCallToken, callReject, callEnd, sendAutoMessage };