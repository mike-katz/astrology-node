const db = require('../db');
require('dotenv').config();
const path = require('path');
const logger = require('log4js').getLogger(path.parse(__filename).name);

const { callEvent } = require("../socket");
const { channelLeave, geneateToken } = require('./agoraController');
const { sendBulkPush } = require('./reviewController');
const { uploadImageTos3 } = require('./uploader');

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
        }

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

async function initAgoraCall(req, res) {
    const { order_id, pandit_id } = req.body || {};
    logger.info('initAgoraCall', { userId: req.userId, order_id, pandit_id });
    if (!order_id || !pandit_id) {
        logger.info('initAgoraCall fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    const response = await geneateToken(order_id);
    if (!response?.success) {
        return res.status(400).json({ success: false, message: response?.message });
    }

    const userData = await db('users').where({ id: Number(req.userId) }).select("profile", "avatar", 'name').first();
    let profile = userData?.profile;
    if (profile) {
        profile = `https://astroguruji2026.s3.ap-south-1.amazonaws.com/avatars/${userData?.avatar}.png`
    }

    console.log("{ order_id, username: userData?.name, profile }", { order_id, username: userData?.name, profile });
    callEvent("emit_to_p_chat_order_call_incoming", {
        key: `pandit_${pandit_id}`,
        payload: { order_id, username: userData?.name, profile }
    });

    logger.info('initAgoraCall success', { userId: req.userId, order_id, pandit_id, response });
    return res.status(200).json(response);
}

module.exports = { getRoom, getMessage, sendMessage, getDetail, getOrderDetail, endChat, forceEndChat, readMessage, deleteChat, getOrderChat, initAgoraCall };