const db = require('../db');
require('dotenv').config();
const path = require('path');
const logger = require('log4js').getLogger(path.parse(__filename).name);
const axios = require('axios');

const { callEvent } = require("../socket");
const { channelLeave, geneateToken } = require('./agoraController');
const { sendBulkPush } = require('./reviewController');
const { uploadImageTos3 } = require('./uploader');
const { emitCallDurationUpdate } = require('../callSocket');
const { replaceTemplate } = require('../utils/replaceTemplate');
const admin = require('../config/firebase');

async function getRoom(req, res) {
    logger.info('chat_getRoom', { userId: req.userId });
    try {
        const type = 'user'
        const id = req.userId
        // Get distinct counterparts
        const rooms = await db('chats')
            .select(
                db.raw(`
            CASE
              WHEN sender_type = ? AND sender_id = ? THEN receiver_type
              ELSE sender_type
            END as other_type
          `, [type, id]),
                db.raw(`
            CASE
              WHEN sender_type = ? AND sender_id = ? THEN receiver_id
              ELSE sender_id
            END as other_id
          `, [type, id])
            )
            .max('created_at as last_at')
            .where(function () {
                this.where(function () {
                    this.where('sender_type', type).andWhere('sender_id', id)
                }).orWhere(function () {
                    this.where('receiver_type', type).andWhere('receiver_id', id)
                })
            })
            .groupBy('other_type', 'other_id');

        // Get last message + unread count per counterpart
        const results = await Promise.all(rooms.map(async r => {
            // last message
            const lastMsg = await db('chats')
                .where(function () {
                    this.where({ sender_type: r.other_type, sender_id: r.other_id, receiver_type: type, receiver_id: id })
                        .orWhere({ sender_type: type, sender_id: id, receiver_type: r.other_type, receiver_id: r.other_id })
                })
                .orderBy('created_at', 'desc')
                .first();

            // unread count
            const unreadCountObj = await db('chats')
                .where({ receiver_type: type, receiver_id: id, sender_type: r.other_type, sender_id: r.other_id, is_read: false })
                .count('* as unread_count')
                .first();

            return [{
                other_type: r.other_type,
                other_id: r.other_id,
                last_message: lastMsg?.message || null,
                last_at: lastMsg?.created_at || null,
                unread_count: parseInt(unreadCountObj.unread_count || 0)
            }];
        }));
        logger.info('chat_getRoom success', { userId: req.userId });
        return res.status(200).json({ success: true, data: results, message: 'Get chat Successfully' });
    } catch (err) {
        logger.error('chat_getRoom error', { userId: req.userId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getMessage(req, res) {
    const { panditId } = req.query || {};
    logger.info('chat_getMessage', { userId: req.userId, panditId });
    if (!panditId) {
        logger.info('chat_getMessage fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 100;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;
        // const messages = await db('chats')
        // .where(function () {
        //     this.where({
        //         sender_type: 'user',
        //         sender_id: req.userId,
        //         receiver_type: 'pandit',
        //         receiver_id: panditId
        //     })
        //         .orWhere({
        //             sender_type: 'pandit',
        //             sender_id: panditId,
        //             receiver_type: 'user',
        //             receiver_id: req.userId
        //         });
        // })
        //     .groupBy('order_id')
        //     .select(
        //         'order_id as orderId',

        //         // 🔹 Chat messages sorted DESC by id
        //         db.raw(`
        //     json_agg(
        //       json_build_object(
        //         'id', id,
        //         'message', message,
        //         'sender_type', sender_type,
        //         'sender_id', sender_id,
        //         'receiver_type', receiver_type,
        //         'receiver_id', receiver_id,
        //         'created_at', created_at
        //       )
        //       ORDER BY id DESC
        //     ) AS chat
        //   `),

        //         // 🔹 Needed for outer sorting
        //         db.raw('MAX(id) AS last_chat_id')
        //     )
        //     // 🔹 Sort orders by latest chat id DESC
        // .orderBy('last_chat_id', 'desc')
        // .limit(limit)
        // .offset(offset);

        // const [{ count }] = await db('chats')
        //     .where(function () {
        //         this.where({
        //             sender_type: 'user',
        //             sender_id: req.userId,
        //             receiver_type: 'pandit',
        //             receiver_id: panditId
        //         })
        //             .orWhere({
        //                 sender_type: 'pandit',
        //                 sender_id: panditId,
        //                 receiver_type: 'user',
        //                 receiver_id: req.userId
        //             });
        //     })
        //     .countDistinct('order_id as count');

        const messages = await db('chats')
            .andWhere(function () {
                this.where({
                    sender_type: 'user',
                    sender_id: req.userId,
                    receiver_type: 'pandit',
                    receiver_id: panditId
                })
                    .orWhere({
                        sender_type: 'pandit',
                        sender_id: panditId,
                        receiver_type: 'user',
                        receiver_id: req.userId
                    });
            })
            .orderBy('id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await db('chats')
            .count('* as count')
            .whereNull('deleted_at')
            .andWhere(function () {
                this.where({
                    sender_type: 'user',
                    sender_id: req.userId,
                    receiver_type: 'pandit',
                    receiver_id: panditId
                })
                    .orWhere({
                        sender_type: 'pandit',
                        sender_id: panditId,
                        receiver_type: 'user',
                        receiver_id: req.userId
                    });
            });
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: messages
        }
        logger.info('chat_getMessage success', { userId: req.userId, panditId });
        return res.status(200).json({ success: true, data: response, message: 'Chat get Successfully' });
    } catch (err) {
        logger.error('chat_getMessage error', { userId: req.userId, panditId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendMessage(req, res) {
    const { orderId, message, type = 'text' } = req.body || {};
    logger.info('chat_sendMessage', { userId: req.userId, orderId, type });
    if (!orderId || !type) {
        logger.info('chat_sendMessage fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ user_id: req.userId, order_id: orderId }).first();
        if (!order) {
            logger.info('chat_sendMessage fail', { userId: req.userId, orderId, message: 'Order not found.' });
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }

        if (order?.end_time && (new Date(order?.end_time).getTime() < new Date()) && order.status == 'continue') {
            // socket.emit("emit_to_chat_completed", {
            //     user: order?.userId,
            //     orderId: order?.orderId,
            // });
            const result = balanceCut(req.userId, order, order?.end_time, 'user -> send message')
            if (!result) {
                logger.info('chat_sendMessage fail', { userId: req.userId, orderId, message: 'Something went wrong.' });
                return res.status(400).json({ success: false, message: 'Something went wrong.' });
            }
            callEvent("emit_to_chat_completed", {
                key: `user_${order?.user_id}`,
                order_id: order?.order_id
            });
            logger.info('chat_sendMessage fail', { userId: req.userId, orderId, message: 'Please regenerate chat request.' });
            return res.status(400).json({ success: false, message: 'Please regenerate chat request.' });
        }
        if (order?.status == "completed") {
            logger.info('chat_sendMessage fail', { userId: req.userId, orderId, message: 'Order is completed.' });
            return res.status(400).json({ success: false, message: 'Order is completed.' });
        }
        if (order?.status == "pending") {
            logger.info('chat_sendMessage fail', { userId: req.userId, orderId, message: 'Order is pending.' });
            return res.status(400).json({ success: false, message: 'Order is pending.' });
        }
        const pandit = await db('pandits').where({ id: Number(order?.pandit_id) }).first();
        const { files } = req
        let response = [];
        if (files?.length > 0) {
            for (const file of files) {
                const image = await uploadImageTos3('message', file, 'chat');
                // console.log("image", image.data.Location);
                const [saved] = await db('chats').insert({
                    sender_type: "user",
                    sender_id: Number(req.userId),
                    receiver_type: "pandit",
                    order_id: orderId,
                    receiver_id: Number(order?.pandit_id),
                    message: image.data.Location,
                    status: "send",
                    type
                }).returning('*');
                response.push(saved)
                if (pandit?.token) {
                    const result = type.charAt(0).toUpperCase() + type.slice(1);
                    sendBulkPush([pandit?.token], req.user, result, data = {})
                }
            }
            // ins.profile_image = image.data.Location;
        } else {
            if (!message) {
                logger.info('chat_sendMessage fail', { userId: req.userId, orderId, message: 'Message required.' });
                return res.status(400).json({ success: false, message: 'Message required.' });
            }
            const [saved] = await db('chats').insert({
                sender_type: "user",
                sender_id: Number(req.userId),
                receiver_type: "pandit",
                order_id: orderId,
                receiver_id: Number(order?.pandit_id),
                message,
                status: "send",
                type
            }).returning('*');
            response = saved
            if (pandit?.token) {
                sendBulkPush([pandit?.token], req.user, message, data = {})
            }
        }
        // console.log("start emit_to_user socket ");
        callEvent("emit_to_user", {
            toType: "pandit",
            toId: order?.pandit_id,
            orderId: order?.order_id,
            payload: response,
        });
        // console.log("end emit_to_user socket ");

        // socket.emit("emit_to_user", {
        //     toType: "user",
        //     toId: order?.userId,
        //     orderId: order?.orderId,
        //     payload: response,
        // });
        logger.info('chat_sendMessage success', { userId: req.userId, orderId });
        return res.status(200).json({ success: true, data: response, message: 'Message send Successfully' });
    } catch (err) {
        logger.error('chat_sendMessage error', { userId: req.userId, orderId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getDetail(req, res) {
    const { panditId, orderId } = req.query || {};
    logger.info('chat_getDetail', { userId: req.userId, panditId, orderId });
    try {
        if (!orderId) {
            logger.info('chat_getDetail fail', { userId: req.userId, message: 'Missing param.' });
            return res.status(400).json({ success: false, message: 'Missing param.' });
        }
        let order
        if (panditId) {
            order = await db('pandits').where({ id: panditId }).first();
            if (!order) {
                logger.info('chat_getDetail fail', { userId: req.userId, panditId, message: 'Pandit not found.' });
                return res.status(400).json({ success: false, message: 'Pandit not found.' });
            }
        }
        let orderDetail
        // let isFirstOrder = true
        // const [{ total }] = await db('orders').where({ pandit_id: panditId, user_id: req.userId }).count('id as total');
        // if (total > 1) {
        //     isFirstOrder = false
        // }
        if (orderId) {
            orderDetail = await db('orders').where({ order_id: orderId }).first();
        }

        if (!order && orderDetail?.pandit_id != null) {
            order = await db('pandits').where({ id: orderDetail?.pandit_id }).first();
        }
        const response = {
            id: panditId, name: order?.display_name, status: order?.status, profile: order?.profile, isOnline: order?.chat, is_free: orderDetail?.is_free, pandit_id: orderDetail?.pandit_id,
            discounted_chat_call_rate: order?.discounted_chat_call_rate,
            final_chat_call_rate: order?.final_chat_call_rate,
            chat_call_rate: order?.chat_call_rate,
            tag: order?.tag,
            rating_1: order?.rating_1,
            rating_2: order?.rating_2,
            rating_3: order?.rating_3,
            rating_4: order?.rating_4,
            rating_5: order?.rating_5,
        }

        if (orderDetail) {
            response.startTime = orderDetail?.start_time;
            response.endTime = orderDetail?.end_time;
            response.order_status = orderDetail?.status
        }

        if (orderDetail?.end_time && (new Date(orderDetail?.end_time).getTime() < new Date()) && orderDetail.status == 'continue') {
            const result = balanceCut(req.userId, orderDetail, orderDetail?.end_time, 'user -> get detail')
            if (!result) {
                logger.info('chat_getDetail fail', { userId: req.userId, orderId, message: 'Something went wrong.' });
                return res.status(400).json({ success: false, message: 'Something went wrong.' });
            }
            callEvent("emit_to_chat_completed", {
                key: `user_${orderDetail?.user_id}`,
                order_id: orderDetail?.order_id
            });
        }
        if (response?.endTime == null) {
            response.start_chat = true
        }
        logger.info('chat_getDetail success', { userId: req.userId, orderId });
        return res.status(200).json({ success: true, data: response, message: 'get detail Successfully' });
    } catch (err) {
        logger.error('chat_getDetail error', { userId: req.userId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getOrderDetail(req, res) {
    const { orderId } = req.query || {};
    logger.info('chat_getOrderDetail', { userId: req.userId, orderId });
    try {
        if (!orderId) {
            logger.info('chat_getOrderDetail fail', { userId: req.userId, message: 'Missing params.' });
            return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        const orderexist = await db('orders').where({ user_id: req.userId, order_id: orderId }).first();
        if (!orderexist) {
            logger.info('chat_getOrderDetail fail', { userId: req.userId, orderId, message: 'Wrong order. Please enter correct' });
            return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        }
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 50;

        if (page < 1) page = 1;
        if (limit < 1) limit = 50;
        const offset = (page - 1) * limit;
        const order = await db('chats').where({ order_id: orderId })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);
        const [{ count }] = await db('chats')
            .count('* as count').where({ order_id: orderId });
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: order
        }
        logger.info('chat_getOrderDetail success', { userId: req.userId, orderId });
        return res.status(200).json({ success: true, data: response, message: 'Get Successfully' });
    } catch (err) {
        logger.error('chat_getOrderDetail error', { userId: req.userId, orderId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

function getDuration(start_time, end_time) {
    const diffMinutes = Math.ceil(
        Math.abs(new Date(end_time) - new Date(start_time)) / (1000 * 60)
    );
    return diffMinutes
}

async function balanceCut(user_id, order, end_time, place) {
    logger.info('balancecut called', { user_id, orderId: order?.order_id });
    try {
        const transaction = await db('balancelogs').where({ order_id: order?.order_id }).first();
        if (transaction) {
            logger.info('balancecut fail', { user_id, orderId: order?.order_id, message: "already order completed" });
            return
        };
        const user = await db('users').where({ id: user_id }).first();
        const diffMinutes = getDuration(order.start_time, end_time)
        // console.log("diffMinutes", diffMinutes);
        const isFree = order.is_free === true;
        let deduction;
        let newBalance;
        let panditAmount;
        const panditDetail = await db('pandits').where({ id: order.pandit_id }).first();

        if (isFree) {
            const settings = await db('settings').first();
            const freeChatPerMinute = Number(settings?.free_chat_amount_per_minute) || 0;
            panditAmount = Number(diffMinutes) * freeChatPerMinute;
            deduction = 0;
            newBalance = Number(user.balance);
        } else {
            const perMinute = Number(order?.rate);
            deduction = Number(diffMinutes) * Number(perMinute);
            newBalance = user.balance - deduction;
            panditAmount = (Number(deduction) * Number(panditDetail?.chat_call_share)) / 100;
        }

        logger.info('balancecut function -> user ', { user_id, newBalance, oldBalance: user?.balance });
        logger.info('balancecut function -> pandit ', { pandit_id: order?.pandit_id, panditAmount });

        if (newBalance < 0) {
            return false
        }
        const upd = { total_orders: 1, }
        if (order.type == 'call') {
            upd.total_call_minutes = Number(diffMinutes)
        } else {
            upd.total_chat_minutes = Number(diffMinutes)
        }
        if (order.type == 'chat') {
            let [saved] = await db('chats').insert({
                sender_type: "user",
                sender_id: Number(user_id),
                receiver_type: "pandit",
                order_id: order?.order_id,
                receiver_id: Number(order?.pandit_id),
                message: `${user?.name} ended the chat`,
                status: "send",
                type: "text",
                is_system_generate: true
            }).returning('*');
            callEvent("emit_to_user", {
                toType: "pandit",
                toId: order?.pandit_id,
                orderId: order?.order_id,
                payload: saved,
            });
            callEvent("emit_to_user", {
                toType: "user",
                toId: order?.user_id,
                orderId: order?.order_id,
                payload: saved,
            });

            if (order?.is_free) {
                [saved] = await db('chats').insert({
                    sender_type: "pandit",
                    sender_id: Number(order?.pandit_id),
                    receiver_type: "user",
                    order_id: order?.order_id,
                    receiver_id: Number(user_id),
                    message: `There is more to see in your chart. Please recharge to continue and connect via call or chat for further guidance.\n\nआपकी कुंडली में और भी बहुत कुछ देखने योग्य है। कृपया आगे बढ़ने के लिए रिचार्ज करें और अधिक मार्गदर्शन के लिए कॉल या चैट के माध्यम से जुड़ें।`,
                    status: "send",
                    type: "text",
                }).returning('*');
                callEvent("emit_to_user", {
                    toType: "pandit",
                    toId: order?.pandit_id,
                    orderId: order?.order_id,
                    payload: saved,
                });
                callEvent("emit_to_user", {
                    toType: "user",
                    toId: order?.user_id,
                    orderId: order?.order_id,
                    payload: saved,
                });
            }
            callEvent("emit_to_chat_end", {
                toType: "pandit",
                toId: order?.pandit_id,
                orderId: order?.order_id,
            });
            callEvent("emit_to_chat_order_completed", {
                toType: "pandit",
                toId: order?.pandit_id,
                orderId: order?.order_id,
            });

            callEvent("emit_to_pending_order", {
                key: `pandit_${order?.pandit_id}`,
                payload: { pandit_id: order?.pandit_id }
            });
        }
        callEvent("emit_to_order_completed", {
            key: `user_${order?.user_id}`,
            payload: { order_id: order?.order_id }
        });

        if (!isFree) {
            await db('users').where({ id: user_id }).update({ balance: newBalance });
        }
        await db('orders').where({ id: order.id }).update({ status: "completed", deduction, duration: diffMinutes, end_time: new Date(end_time) });
        upd.balance = panditAmount
        logger.info('balancecut function -> pandit update param', { ...upd, pandit_id: order.pandit_id })
        await db('pandits').where({ id: order.pandit_id }).increment(upd).update({ waiting_time: null });
        const pandit_new_balance = Number(panditDetail?.balance) + Number(panditAmount)
        const type = order.type.charAt(0).toUpperCase() + order.type.slice(1);
        await db('balancelogs').insert({ place, order_id: order?.order_id, user_id, pandit_old_balance: Number(panditDetail?.balance), pandit_new_balance, user_old_balance: Number(user.balance), user_new_balance: Number(newBalance), message: `${type} with ${panditDetail?.display_name} for ${diffMinutes} minutes Rate(${order?.rate})`, pandit_id: panditDetail?.id, pandit_message: `${type} with ${user?.name} for ${diffMinutes} minutes. Rate(${order?.rate})`, pandit_amount: panditAmount, amount: isFree ? 0 : -deduction });
        // console.log("user", dd);
        // console.log("order", dds);
        return true
    } catch (err) {
        // console.log("err", err);
        logger.info('balancecut function -> fail', { user_id, orderId: order?.order_id, err: err?.message })
        return false
    }
}

async function endChat(req, res) {
    const { orderId } = req.body || {};
    logger.info('chat_endChat', { userId: req.userId, orderId });
    if (!orderId) {
        logger.info('chat_endChat fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ user_id: req.userId, order_id: orderId }).first();
        if (!order) {
            logger.info('chat_endChat fail', { userId: req.userId, orderId, message: 'Wrong order. Please enter correct' });
            return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        }
        // const diffMinutes = getDuration(order.start_time, new Date());
        const diffMs = Math.abs(new Date() - new Date(order.start_time));
        const totalSeconds = Math.floor(diffMs / 1000);
        const setting = await db('settings').first();
        console.log("totalSeconds", totalSeconds);
        const minSec = setting?.chat_end_min_minutes * 60
        console.log("minSec required", minSec);

        if (order.status == 'pending') {
            logger.info('chat_endChat fail', { userId: req.userId, orderId, message: 'order is pending.' });
            return res.status(400).json({ success: false, message: 'order is pending.' });
        }
        if (order.status == 'cancel') {
            logger.info('chat_endChat fail', { userId: req.userId, orderId, message: 'order is rejected.' });
            return res.status(400).json({ success: false, message: 'order is rejected.' });
        }
        if (order.status == 'completed') {
            logger.info('chat_endChat fail', { userId: req.userId, orderId, message: 'order is already completed.' });
            return res.status(200).json({ success: false, message: 'order is already completed.' });
        }

        // console.log("endChat diffMinutes", diffMinutes, "startTime", order.start_time, "endTime", new Date());
        if ((totalSeconds < Number(minSec)) && !order?.is_free && order?.type == 'chat') {
            logger.info('chat_endChat fail', { userId: req.userId, orderId, message: `Can't end chat in first ${setting?.chat_end_min_minutes} minute.` });
            return res.status(400).json({ success: false, message: `Can't end chat in first ${setting?.chat_end_min_minutes} minute.` });
        }
        // const [{ total }] = await db('orders').where({ pandit_id: order?.pandit_id, user_id: req.userId }).count('id as total');
        // if (total == 1) {
        //     return res.status(400).json({ success: false, message: 'You can not end this chat.' });
        // }
        // if (order.status != 'continue') {
        //     return res.status(400).json({ success: false, message: 'order is pending or completed.' });
        // }
        if (order.type == 'call') {
            const dd = await channelLeave(orderId)
        }
        let now = new Date();
        if (order.end_time) {
            const orderEndTime = new Date(order.end_time);
            if (now > orderEndTime) {
                now = order.end_time
            }
        }
        const result = await balanceCut(req.userId, order, now, "user -> chat end");
        if (!result) {
            logger.info('chat_endChat fail', { userId: req.userId, orderId, message: 'Something went wrong.' });
            return res.status(400).json({ success: false, message: 'Something went wrong.' });
        }
        // calculate pandit and user balance 
        // socket.emit("emit_to_chat_completed", {
        //     user: order?.userId,
        //     orderId: order?.orderId,
        // });

        callEvent("emit_to_chat_completed", {
            key: `user_${order?.user_id}`,
            order_id: order?.order_id,
        });

        logger.info('chat_endChat success', { userId: req.userId, orderId });
        return res.status(200).json({ success: true, data: null, message: 'End chat successfully.' });
    } catch (err) {
        logger.error('chat_endChat error', { userId: req.userId, orderId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function forceEndChat(req, res) {
    const { orderId } = req.body || {};
    logger.info('chat_forceEndChat', { userId: req.userId, orderId });
    if (!orderId) {
        logger.info('chat_forceEndChat fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ user_id: req.userId, order_id: orderId }).first();
        if (!order) {
            logger.info('chat_forceEndChat fail', { userId: req.userId, orderId, message: 'Wrong order. Please enter correct' });
            return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        }
        if (order.status == 'pending') {
            logger.info('chat_forceEndChat fail', { userId: req.userId, orderId, message: 'order is pending.' });
            return res.status(400).json({ success: false, message: 'order is pending.' });
        }
        if (order.status == 'cancel') {
            logger.info('chat_forceEndChat fail', { userId: req.userId, orderId, message: 'order is rejected.' });
            return res.status(400).json({ success: false, message: 'order is rejected.' });
        }
        if (order.status == 'completed') {
            logger.info('chat_forceEndChat fail', { userId: req.userId, orderId, message: 'order is already completed.' });
            return res.status(200).json({ success: false, message: 'order is already completed.' });
        }

        if (order?.end_time && (new Date(order?.end_time).getTime() > new Date())) {
            logger.info('chat_forceEndChat fail', { userId: req.userId, orderId, message: 'Order is ongoing.' });
            return res.status(400).json({ success: false, message: 'Order is ongoing.' });
        }

        const result = await balanceCut(req.userId, order, order?.end_time, 'user -> force end');
        if (!result) {
            logger.info('chat_forceEndChat fail', { userId: req.userId, orderId, message: 'Something went wrong.' });
            return res.status(400).json({ success: false, message: 'Something went wrong.' });
        }

        // await db('orders').where({ order_id: orderId }).update({ status: "completed", end_time: new Date() });
        // socket.emit("emit_to_chat_completed", {
        //     user: order?.userId,
        //     orderId: order?.orderId,
        // });

        callEvent("emit_to_chat_completed", {
            key: `user_${order?.user_id}`,
            order_id: order?.order_id,
        });

        logger.info('chat_forceEndChat success', { userId: req.userId, orderId });
        return res.status(200).json({ success: true, data: null, message: 'End chat successfully.' });
    } catch (err) {
        logger.error('chat_forceEndChat error', { userId: req.userId, orderId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function readMessage(req, res) {
    const { chatId } = req.body || {};
    logger.info('chat_readMessage', { userId: req.userId, chatId });
    try {
        await db('chats').where({ id: chatId }).update({ status: "read" });
        logger.info('chat_readMessage success', { userId: req.userId, chatId });
        return res.status(200).json({ success: true, message: 'Read success.' });
    }
    catch (err) {
        logger.error('chat_readMessage error', { userId: req.userId, chatId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteChat(req, res) {
    const { id } = req.query || {};
    logger.info('chat_deleteChat', { userId: req.userId, id });
    try {
        if (!id) {
            logger.info('chat_deleteChat fail', { userId: req.userId, message: 'Missing params.' });
            return res.status(400).json({ success: false, message: 'Missing params.' });
        }

        const chat = await db('chats').where({ id })
            .andWhere(function () {
                this.where({
                    sender_type: 'user',
                    sender_id: req.userId,
                })
                    .orWhere({
                        receiver_type: 'user',
                        receiver_id: req.userId
                    });
            }).first();

        if (!chat) {
            logger.info('chat_deleteChat fail', { userId: req.userId, id, message: 'You can not delete this message.' });
            return res.status(400).json({ success: false, message: 'You can not delete this message.' });
        }
        const upd = {
            receiver_delete: false,
            sender_delete: false,
        }
        let pandit_id = chat?.sender_id;
        if (chat?.sender_type == 'user') {
            upd.sender_delete = true
            upd.deleted_at = new Date()
            pandit_id = chat?.receiver_id
            const response = { ...chat, ...upd }
            callEvent("emit_to_chat_deleted", {
                userKey: `user_${req.userId}`,
                panditKey: `pandit_${pandit_id}`,
                data: response,
            });
        } else {
            upd.receiver_delete = true
            const response = { ...chat, ...upd }
            callEvent("emit_to_chat_deleted", {
                panditKey: `pandit_${pandit_id}`,
                data: response,
            });
        }
        await db('chats').where({ id }).update(upd);
        logger.info('chat_deleteChat success', { userId: req.userId, id });
        return res.status(200).json({ success: true, message: 'Chat delete Successfully' });
    } catch (err) {
        logger.error('chat_deleteChat error', { userId: req.userId, id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getOrderChat(req, res) {
    const { order_id } = req.query || {};
    logger.info('chat_getOrderChat', { userId: req.userId, order_id });
    if (!order_id) {
        logger.info('chat_getOrderChat fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 100;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;
        const messages = await db('chats')
            .where({ order_id })
            .whereNull('deleted_at')
            .orderBy('id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await db('chats')
            .count('* as count')
            .whereNull('deleted_at')
            .where({ order_id });
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);
        const response = {
            page,
            limit,
            total,
            totalPages,
            results: messages
        }
        logger.info('chat_getOrderChat success', { userId: req.userId, order_id });
        return res.status(200).json({ success: true, data: response, message: 'Chat get Successfully' });
    } catch (err) {
        logger.error('chat_getOrderChat error', { userId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function newCreateOrder(req, res) {
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
        const settings = await db('settings').first();
        if (count == 0 && type == 'chat') {
            duration = Number(settings?.free_chat_minutes) || 0;
            deduction = 0;
            rate = settings?.free_chat_amount_per_minute || 1;
        } else {
            if (user?.balance < 1) {
                logger.info('order_create fail', { userId: req.userId, message: 'Please recharge your wallet.' });
                return res.status(400).json({ success: false, message: 'Please recharge your wallet.' });
            }
            // settings?.
            if (duration < 1) {
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
        if (count == 0 && type == 'chat') {
            ins.is_free = true
        }

        const [saved] = await db('orders').insert(ins).returning('*');
        // console.log("order inserted", saved);

        // console.log("start socket call");

        const profile = await db('userprofiles').where({ id: Number(profile_id) }).first();

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
        if (token) {
            const waiting_time = pandit?.waiting_time == null ? true : false
            await sendNotification(token, user?.name, pandit?.final_chat_call_rate, panditId, type, waiting_time, orderId, user?.id, user?.profile, user?.avatar)
        }
        // socket.emit("emit_to_user_for_register", {
        //     key: `user_${req?.userId}`,
        //     payload: [{ ...saved, name: pandit?.name, profile: pandit?.profile }],
        // });

        axios({
            method: 'post',
            url: process.env.ADMIN_CALLBACK_URL,
            data: {
                name: pandit?.display_name,
                id: pandit?.id,
                mobile: pandit?.mobile,
                order_id: orderId,
                type: "astrologer"
            }
        });
        logger.info('order_create success', { userId: req.userId, orderId, panditId, type });
        return res.status(200).json({ success: true, data: { orderId }, message: 'Order create Successfully' });
    } catch (err) {
        logger.error('order_create error', { userId: req.userId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendNotification(token, username, chat_call_rate, panditId, type, is_free = false, order_id, user_id, profile, avatar) {
    // console.log("is_available", is_available);
    console.log("order_id, user_id", order_id, user_id);
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
            const profileUrl = profile ? profile : `https://astroguruji2026.s3.ap-south-1.amazonaws.com/avatars/${avatar}.png`
            console.log("profileUrl", profileUrl);
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
            let defaultMode = false
            const panditLogins = await db('pandit_online_check').where({ pandit_id: Number(panditId) }).first();
            if (panditLogins) {
                const now = new Date();
                const createdAt = new Date(panditLogins?.created_at); // DB mathi aavelo time

                const diffInSeconds = (now - createdAt) / 1000;
                console.log("diffInSeconds", diffInSeconds);
                if (diffInSeconds < 60) {
                    defaultMode = true
                }
            }

            if (defaultMode) {
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

                    data: {
                        type: type == 'chat' ? "incoming_chat" : "incoming_call",
                        title: messages,
                        orderId: String(order_id),
                        userId: String(user_id),
                        profile: profileUrl,
                        userName: username
                    },
                };
            }
            else {
                logger.info("inside else");

                message = {
                    token, // This must be the VoIP Token, not the standard FCM token
                    // notification: {
                    //     title: messages,
                    // },
                    android: {
                        priority: "high",
                        notification: {
                            title: messages,
                        },
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
                            title: messages,
                            // ... other data
                        }
                    },
                    data: {
                        type: type == 'chat' ? "incoming_chat" : "incoming_call",
                        title: messages,
                        order_id: String(order_id),
                        userId: String(user_id),
                        profile: profileUrl,
                        userName: username
                    },
                };
            }
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


function formatDOB(dob) {
    if (!dob) return '';
    return new Date(dob).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function formatValue(value) {
    if (!value) return '';

    return value
        .toString()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

async function orderAccept(req, res) {
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

        const userDetail = await db('users').where({ id: order.user_id }).first();

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

            if (duration < 1) {
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
            callEvent("emit_to_chat_order_accepted", {
                key: `pandit_${order?.pandit_id}`,
                payload: { startTime, endTime, orderId, user_id: order?.user_id }
            });
        }
        // if (order.type == 'call') {
        //     // console.log("emit_to_user_call_end_time call start",);
        //     callEvent("emit_to_chat_order_accepted", {
        //         key: `pandit_${order?.pandit_id}`,
        //         payload: { startTime, endTime, orderId }
        //     });
        //     // console.log("emit_to_user_call_end_time call end",);

        // }

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

async function orderCancel(req, res) {
    const { order_id } = req.body || {};
    logger.info('order_cancelOrder', { userId: req.userId, order_id });
    try {
        if (!order_id) {
            logger.info('order_cancelOrder fail', { userId: req.userId, message: 'Order id required.' });
            return res.status(400).json({ success: false, message: 'Order id required.' });
        }
        const order = await db('orders').where({ order_id: order_id, user_id: req.userId, status: "pending" }).first();
        if (!order) {
            logger.info('order_cancelOrder fail', { userId: req.userId, order_id, message: 'You can not cancel this order.' });
            return res.status(400).json({ success: false, message: 'You can not cancel this order.' });
        }
        const upd = {}
        let status = 'cancel';
        // if (!order?.is_accept) {
        //     upd.canceled_at = new Date()
        // }
        // if (order?.is_accept) {
        //     status = 'rejected'
        // }
        upd.status = status
        await db('orders').where({ id: order?.id }).update(upd);

        callEvent("emit_to_pending_order", {
            key: `pandit_${order?.pandit_id}`,
            payload: { pandit_id: order?.pandit_id }
        });

        // if (order.type == 'chat') {
        //     callEvent("emit_to_chat_rejected", {
        //         key: `pandit_${order?.pandit_id}`,
        //         order_id: order?.order_id,
        //     });
        // } else {
        //     callEvent("emit_to_call_rejected", {
        //         key: `pandit_${order?.pandit_id}`,
        //         order_id: order?.order_id,
        //     });
        // }
        logger.info('order_cancelOrder success', { userId: req.userId, order_id });
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        logger.error('order_cancelOrder error', { userId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function orderReject(req, res) {
    const { order_id } = req.body || {};
    logger.info('order_rejectOrder', { userId: req.userId, order_id });
    try {
        if (!order_id) {
            logger.info('order_rejectOrder fail', { userId: req.userId, message: 'Order id required.' });
            return res.status(400).json({ success: false, message: 'Order id required.' });
        }
        const order = await db('orders').where({ order_id: order_id, user_id: req.userId, status: "pending" }).first();
        if (!order) {
            logger.info('order_rejectOrder fail', { userId: req.userId, order_id, message: 'You can not cancel this order.' });
            return res.status(400).json({ success: false, message: 'You can not cancel this order.' });
        }
        const upd = {}
        let status = 'rejected';
        // if (!order?.is_accept) {
        //     upd.canceled_at = new Date()
        // }
        // if (order?.is_accept) {
        //     status = 'rejected'
        // }
        upd.status = status
        await db('orders').where({ id: order?.id }).update(upd);

        callEvent("emit_to_pending_order", {
            key: `pandit_${order?.pandit_id}`,
            payload: { pandit_id: order?.pandit_id }
        });

        if (order.type == 'chat') {
            callEvent("emit_to_order_chat_rejected", {
                key: `pandit_${order?.pandit_id}`,
                order_id: order?.order_id,
            });
        }
        //  else {
        //     callEvent("emit_to_call_rejected", {
        //         key: `pandit_${order?.pandit_id}`,
        //         order_id: order?.order_id,
        //     });
        // }
        logger.info('order_rejectOrder success', { userId: req.userId, order_id });
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        logger.error('order_rejectOrder error', { userId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function newOrderDetail(req, res) {
    const { order_id } = req.query || {};
    logger.info('chat_getDetail', { userId: req.userId, order_id });
    try {
        if (!order_id) {
            logger.info('chat_getDetail fail', { userId: req.userId, message: 'Missing param.' });
            return res.status(400).json({ success: false, message: 'Missing param.' });
        }
        let pandit
        // if (panditId) {
        //     order = await db('pandits').where({ id: panditId }).first();
        //     if (!order) {
        //         logger.info('chat_getDetail fail', { userId: req.userId, panditId, message: 'Pandit not found.' });
        //         return res.status(400).json({ success: false, message: 'Pandit not found.' });
        //     }
        // }
        let orderDetail = await db('orders').where({ order_id }).first();
        // let isFirstOrder = true
        // const [{ total }] = await db('orders').where({ pandit_id: panditId, user_id: req.userId }).count('id as total');
        // if (total > 1) {
        //     isFirstOrder = false
        // }
        // if (order_id) {

        // }

        if (orderDetail?.pandit_id != null) {
            pandit = await db('pandits').where({ id: orderDetail?.pandit_id }).first();
        }
        const response = {
            id: orderDetail?.pandit_id, name: pandit?.display_name, status: pandit?.status, profile: pandit?.profile, isOnline: pandit?.chat, is_free: orderDetail?.is_free, pandit_id: orderDetail?.pandit_id,
            discounted_chat_call_rate: pandit?.discounted_chat_call_rate,
            final_chat_call_rate: pandit?.final_chat_call_rate,
            chat_call_rate: pandit?.chat_call_rate,
            tag: pandit?.tag,
            rating_1: pandit?.rating_1,
            rating_2: pandit?.rating_2,
            rating_3: pandit?.rating_3,
            rating_4: pandit?.rating_4,
            rating_5: pandit?.rating_5,
        }

        if (orderDetail) {
            response.startTime = orderDetail?.start_time;
            response.endTime = orderDetail?.end_time;
            response.order_status = orderDetail?.status
        }

        if (orderDetail?.end_time && (new Date(orderDetail?.end_time).getTime() < new Date()) && orderDetail.status == 'continue') {
            const result = balanceCut(req.userId, orderDetail, orderDetail?.end_time, 'user -> get detail')
            if (!result) {
                logger.info('chat_getDetail fail', { userId: req.userId, order_id, message: 'Something went wrong.' });
                return res.status(400).json({ success: false, message: 'Something went wrong.' });
            }
            callEvent("emit_to_chat_completed", {
                key: `user_${orderDetail?.user_id}`,
                order_id: orderDetail?.order_id
            });
        }
        if (response?.endTime == null) {
            response.start_chat = true
        }
        logger.info('chat_getDetail success', { userId: req.userId, order_id });
        return res.status(200).json({ success: true, data: response, message: 'get detail Successfully' });
    } catch (err) {
        logger.error('chat_getDetail error', { userId: req.userId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function endOrder(req, res) {
    const { order_id, return_event } = req.body || {};
    logger.info('chat_endChat', { userId: req.userId, order_id });
    if (!order_id) {
        logger.info('chat_endChat fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ user_id: req.userId, order_id: order_id }).first();
        if (!order) {
            logger.info('chat_endChat fail', { userId: req.userId, order_id, message: 'Wrong order. Please enter correct' });
            return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        }
        // const diffMinutes = getDuration(order.start_time, new Date());
        const diffMs = Math.abs(new Date() - new Date(order.start_time));
        const totalSeconds = Math.floor(diffMs / 1000);
        const setting = await db('settings').first();
        console.log("totalSeconds", totalSeconds);
        const minSec = setting?.chat_end_min_minutes * 60
        console.log("minSec required", minSec);

        if (order.status == 'pending') {
            logger.info('chat_endChat fail', { userId: req.userId, order_id, message: 'order is pending.' });
            return res.status(400).json({ success: false, message: 'order is pending.' });
        }
        if (order.status == 'cancel') {
            logger.info('chat_endChat fail', { userId: req.userId, order_id, message: 'order is rejected.' });
            return res.status(400).json({ success: false, message: 'order is rejected.' });
        }
        if (order.status == 'completed') {
            logger.info('chat_endChat fail', { userId: req.userId, order_id, message: 'order is already completed.' });
            return res.status(200).json({ success: false, message: 'order is already completed.' });
        }

        // console.log("endChat diffMinutes", diffMinutes, "startTime", order.start_time, "endTime", new Date());
        if ((totalSeconds < Number(minSec)) && !order?.is_free && order?.type == 'chat') {
            logger.info('chat_endChat fail', { userId: req.userId, order_id, message: `Can't end chat in first ${setting?.chat_end_min_minutes} minute.` });
            return res.status(400).json({ success: false, message: `Can't end chat in first ${setting?.chat_end_min_minutes} minute.` });
        }
        // const [{ total }] = await db('orders').where({ pandit_id: order?.pandit_id, user_id: req.userId }).count('id as total');
        // if (total == 1) {
        //     return res.status(400).json({ success: false, message: 'You can not end this chat.' });
        // }
        // if (order.status != 'continue') {
        //     return res.status(400).json({ success: false, message: 'order is pending or completed.' });
        // }
        if (order.type == 'call') {
            const dd = await channelLeave(order_id)
        }
        let now = new Date();
        if (order.end_time) {
            const orderEndTime = new Date(order.end_time);
            if (now > orderEndTime) {
                now = order.end_time
            }
        }
        const result = await balanceCut(req.userId, order, now, "user -> chat end");
        if (!result) {
            logger.info('chat_endChat fail', { userId: req.userId, order_id, message: 'Something went wrong.' });
            return res.status(400).json({ success: false, message: 'Something went wrong.' });
        }
        // calculate pandit and user balance 
        // socket.emit("emit_to_chat_completed", {
        //     user: order?.userId,
        //     order_id: order?.order_id,
        // });

        callEvent("emit_to_chat_completed", {
            key: `user_${order?.user_id}`,
            order_id: order?.order_id,
        });
        if (return_event) {
            callEvent("emit_to_chat_order_call_completed", {
                key: `user_${order?.user_id}`,
                order_id: order?.order_id,
            });
        }

        logger.info('chat_endChat success', { userId: req.userId, order_id });
        return res.status(200).json({ success: true, data: null, message: 'End chat successfully.' });
    } catch (err) {
        logger.error('chat_endChat error', { userId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function createCall(req, res) {
    const { order_id, pandit_id } = req.body;
    try {
        const oredrDetail = await db('orders').where({ order_id, status: "continue", pandit_id }).first();
        if (!oredrDetail) {
            logger.info('chat_order_call fail', { order_id, message: 'Order not found.' });
            return res.status(400).json({ success: false, message: 'Something went wrong.' });
        }
        const numbers = ["+911413232575", "+911413231101", "+911413232574", "+911413231093"]
        const userDetail = await db('users').select('id', 'mobile', 'country_code').where({ id: Number(req.userId) }).first()
        const panditDetail = await db('pandits').select('id', 'mobile', 'country_code').where({ id: Number(pandit_id) }).first()
        const setting = await db('settings').select('minimum_call_send_time').first()
        const did = numbers[Math.floor(Math.random() * numbers.length)];
        console.log("call params", {
            source: `${panditDetail?.country_code}${panditDetail?.mobile}`,
            destination: `${userDetail?.country_code}${userDetail?.mobile}`,
            did,
            order_id
        });
        const createdAt = new Date(oredrDetail?.end_time);
        const diffSeconds = Math.floor((createdAt.getTime() - Date.now()) / 1000);
        console.log("diffSeconds", diffSeconds);
        if (diffSeconds < Number(setting?.minimum_call_send_time || 60)) {
            logger.info('chat_order_call fail', { order_id, message: 'Minimum call duration.' });
            return res.status(400).json({ success: false, message: `Minimum call duration ${Number(setting?.minimum_call_send_time || 60)} Required.` });
        }
        const response = await axios({
            method: 'post',
            url: process.env.CALL_URL,
            headers: { Authorization: process.env.CALL_TOKEN },
            data: {
                source: `${panditDetail?.country_code}${panditDetail?.mobile}`,
                destination: `${userDetail?.country_code}${userDetail?.mobile}`,
                // did: "+911413231099",//["+911413231091", "+911413231099"]
                did
            }
        });

        console.log("response,response", response?.data);
        // emitCallDurationUpdate(response?.data?.call_id, Number(diffSeconds))
        callEvent("emit_to_u_chat_order_call_send_user", {
            key: `user_${userDetail?.id}`,
            order_id,
        });
        await db('orders').where({ order_id }).update({ call_id: response?.data?.call_id, call_from: "user" })
        await db('order_call_log').insert({ call_id: response?.data?.call_id, order_id, pandit_id, user_id: req.userId, status: "Call Initiated" })
        res.status(200).json({ success: true, message: "Call initiated" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function rejectCall(req, res) {
    const { order_id, pandit_id } = req.body;
    try {
        callEvent("emit_to_chat_order_call_reject", {
            key: `pandit_${pandit_id}`,
            order_id,
        });
        return res.status(200).json({ success: true, data: null, message: 'End chat successfully.' });
    } catch (err) {
        logger.error('rejectCall error', { userId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = {
    getRoom, getMessage, sendMessage, getDetail, getOrderDetail, endChat, forceEndChat, readMessage, deleteChat, getOrderChat,
    newCreateOrder, orderAccept, orderCancel, orderReject, newOrderDetail, endOrder, createCall, rejectCall
};