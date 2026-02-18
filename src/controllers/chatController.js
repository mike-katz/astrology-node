const db = require('../db');
require('dotenv').config();
const { callEvent } = require("../socket");
const { channelLeave } = require('./agoraController');
const { uploadImageTos3 } = require('./uploader');

async function getRoom(req, res) {
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
        return res.status(200).json({ success: true, data: results, message: 'Get chat Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getMessage(req, res) {
    const { panditId } = req.query;
    if (!panditId) {
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
        return res.status(200).json({ success: true, data: response, message: 'Chat get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendMessage(req, res) {
    const { orderId, message, type = 'text' } = req.body;
    if (!orderId || !type) {
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ user_id: req.userId, order_id: orderId }).first();
        if (!order) return res.status(400).json({ success: false, message: 'Order not found.' });

        if (order?.end_time && (new Date(order?.end_time).getTime() < new Date()) && order.status == 'continue') {
            // socket.emit("emit_to_chat_completed", {
            //     user: order?.userId,
            //     orderId: order?.orderId,
            // });
            const result = balanceCut(req.userId, order, order?.end_time)
            if (!result) {
                return res.status(400).json({ success: false, message: 'Something went wrong.' });
            }
            callEvent("emit_to_chat_completed", {
                key: `user_${order?.user_id}`,
                order_id: order?.order_id
            });
            return res.status(400).json({ success: false, message: 'Please regenerate chat request.' });
        }
        if (order?.status == "completed") {
            return res.status(400).json({ success: false, message: 'Order is completed.' });
        }
        if (order?.status == "pending") {
            return res.status(400).json({ success: false, message: 'Order is pending.' });
        }
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
            }
            // ins.profile_image = image.data.Location;
        } else {
            if (!message) return res.status(400).json({ success: false, message: 'Message required.' });
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
        return res.status(200).json({ success: true, data: response, message: 'Message send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getDetail(req, res) {
    const { panditId, orderId } = req.query;
    try {
        if (!orderId) return res.status(400).json({ success: false, message: 'Missing param.' });
        let order
        if (panditId) {
            order = await db('pandits').where({ id: panditId }).first();
            if (!order) return res.status(400).json({ success: false, message: 'Pandit not found.' });
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
        }

        if (orderDetail?.end_time && (new Date(orderDetail?.end_time).getTime() < new Date()) && orderDetail.status == 'continue') {
            const result = balanceCut(req.userId, orderDetail, orderDetail?.end_time)
            if (!result) {
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
        return res.status(200).json({ success: true, data: response, message: 'get detail Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getOrderDetail(req, res) {
    const { orderId } = req.query;
    try {
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        const orderexist = await db('orders').where({ user_id: req.userId, order_id: orderId }).first();
        if (!orderexist) return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
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
        return res.status(200).json({ success: true, data: response, message: 'Get Successfully' });
    } catch (err) {
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
async function balanceCut(user_id, order, end_time) {
    try {
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

        // console.log("deduction", deduction);
        // console.log("newBalance", newBalance, "username", user?.name);
        const upd = { total_orders: 1, }
        if (order.type == 'call') {
            upd.total_call_minutes = Number(diffMinutes)
        } else {
            upd.total_chat_minutes = Number(diffMinutes)
        }
        if (order.type == 'chat') {
            const [saved] = await db('chats').insert({
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
        await db('pandits').where({ id: order.pandit_id }).increment(upd).update({ waiting_time: null });
        const pandit_new_balance = Number(panditDetail?.balance) + Number(panditAmount)
        const type = order.type.charAt(0).toUpperCase() + order.type.slice(1);
        await db('balancelogs').insert({ order_id: order?.order_id, user_id, pandit_old_balance: Number(panditDetail?.balance), pandit_new_balance, user_old_balance: Number(user.balance), user_new_balance: Number(newBalance), message: `${type} with ${panditDetail?.display_name} for ${diffMinutes} minutes`, pandit_id: panditDetail?.id, pandit_message: `${type} with ${user?.name} for ${diffMinutes} minutes`, pandit_amount: panditAmount, amount: isFree ? 0 : -deduction });
        // console.log("user", dd);
        // console.log("order", dds);
        return true
    } catch (err) {
        // console.log("err", err);
        return false
    }
}

async function endChat(req, res) {
    const { orderId } = req.body;
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ user_id: req.userId, order_id: orderId }).first();
        if (!order) {
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
            return res.status(400).json({ success: false, message: 'order is pending.' });
        }
        if (order.status == 'cancel') {
            return res.status(400).json({ success: false, message: 'order is rejected.' });
        }
        if (order.status == 'completed') {
            return res.status(200).json({ success: false, message: 'order is already completed.' });
        }

        // console.log("endChat diffMinutes", diffMinutes, "startTime", order.start_time, "endTime", new Date());
        if ((totalSeconds < Number(minSec)) && !order?.is_free && order?.type == 'chat') return res.status(400).json({ success: false, message: `Can't end chat in first ${setting?.chat_end_min_minutes} minute.` });
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
        const result = await balanceCut(req.userId, order, new Date());
        if (!result) {
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

        return res.status(200).json({ success: true, data: null, message: 'End chat successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function forceEndChat(req, res) {
    const { orderId } = req.body;
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ user_id: req.userId, order_id: orderId }).first();
        if (!order) {
            return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        }
        if (order.status == 'pending') {
            return res.status(400).json({ success: false, message: 'order is pending.' });
        }
        if (order.status == 'cancel') {
            return res.status(400).json({ success: false, message: 'order is rejected.' });
        }
        if (order.status == 'completed') {
            return res.status(200).json({ success: false, message: 'order is already completed.' });
        }

        if (order?.end_time && (new Date(order?.end_time).getTime() > new Date())) {
            return res.status(400).json({ success: false, message: 'Order is ongoing.' });
        }

        const result = await balanceCut(req.userId, order, order?.end_time);
        if (!result) {
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

        return res.status(200).json({ success: true, data: null, message: 'End chat successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function readMessage(req, res) {
    const { chatId } = req.body
    try {
        await db('chats').where({ id: chatId }).update({ status: "read" });
        return res.status(200).json({ success: true, message: 'Read success.' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteChat(req, res) {
    try {
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, message: 'Missing params.' });

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

        if (!chat) return res.status(400).json({ success: false, message: 'You can not delete this message.' });
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
        return res.status(200).json({ success: true, message: 'Chat delete Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getOrderChat(req, res) {
    const { order_id } = req.query;
    if (!order_id) {
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
        return res.status(200).json({ success: true, data: response, message: 'Chat get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getRoom, getMessage, sendMessage, getDetail, getOrderDetail, endChat, forceEndChat, readMessage, deleteChat, getOrderChat };