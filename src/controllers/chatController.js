const db = require('../db');
require('dotenv').config();
const { callEvent } = require("../socket");
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

        const messages = await db('chats')
            .where(function () {
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
            .orderBy('created_at', 'asc')
            .limit(limit)
            .offset(offset);

        // Mark messages received by me as read
        await db('chats')
            .where({ receiver_type: 'user', receiver_id: req.userId, sender_type: 'pandit', sender_id: panditId, is_read: false })
            .update({ is_read: true });
        return res.status(200).json({ success: true, data: messages, message: 'Chat get Successfully' });
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
        const order = await db('orders').where({ userId: req.userId, orderId }).first();
        if (!order) return res.status(400).json({ success: false, message: 'Order not found.' });

        if (order?.endTime && (new Date(order?.endTime).getTime() < new Date())) {
            await db('orders').where({ id: order?.id }).update({ status: "completed" });
            // socket.emit("emit_to_chat_completed", {
            //     user: order?.userId,
            //     orderId: order?.orderId,
            // });

            callEvent("emit_to_chat_completed", {
                user: order?.userId,
                orderId: order?.orderId
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
                console.log("image", image.data.Location);
                const [saved] = await db('chats').insert({
                    sender_type: "user",
                    sender_id: Number(req.userId),
                    receiver_type: "pandit",
                    orderId,
                    receiver_id: Number(order?.panditId),
                    lastmessage: image.data.Location,
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
                orderId,
                receiver_id: Number(order?.panditId),
                lastmessage: message,
                message,
                status: "send",
                type
            }).returning('*');
            response = saved
        }

        callEvent("emit_to_user", {
            toType: "user",
            toId: order?.userId,
            orderId: order?.orderId,
            payload: response,
        });

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
        const order = await db('pandits').where({ id: panditId }).first();
        if (!order) return res.status(400).json({ success: false, message: 'Pandit not found.' });
        let orderDetail
        let isFirstOrder = true
        const [{ total }] = await db('orders').where({ panditId, userId: req.userId }).count('id as total');
        if (total > 1) {
            isFirstOrder = false
        }
        if (orderId) {
            orderDetail = await db('orders').where({ orderId }).first();
        }
        const response = { id: panditId, name: order?.name, profile: order?.profile, isOnline: order?.isOnline, isFirstOrder }
        if (orderDetail) {
            response.startTime = orderDetail?.startTime;
            response.endTime = orderDetail?.endTime;
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
        const orderexist = await db('orders').where({ userId: req.userId, orderId }).first();
        if (!orderexist) return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 50;

        if (page < 1) page = 1;
        if (limit < 1) limit = 50;
        const offset = (page - 1) * limit;
        const order = await db('chats').where({ orderId })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .offset(offset);
        const [{ count }] = await db('chats')
            .count('* as count').where({ orderId });
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

async function endChat(req, res) {
    const { orderId } = req.body;
    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ userId: req.userId, orderId }).first();
        if (!order) {
            return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        }
        const [{ total }] = await db('orders').where({ panditId: order?.panditId, userId: req.userId }).count('id as total');
        if (total == 1) {
            return res.status(400).json({ success: false, message: 'You can not end this chat.' });
        }
        if (order.status != 'continue') {
            return res.status(400).json({ success: false, message: 'order is pending or completed.' });
        }

        await db('orders').where({ orderId }).update({ status: "completed", endTime: new Date() });
        // socket.emit("emit_to_chat_completed", {
        //     user: order?.userId,
        //     orderId: order?.orderId,
        // });

        callEvent("emit_to_chat_completed", {
            user: order?.userId,
            orderId: order?.orderId,
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
        const order = await db('orders').where({ userId: req.userId, orderId }).first();
        if (!order) {
            return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        }

        if (order?.endTime && (new Date(order?.endTime).getTime() > new Date())) {
            return res.status(400).json({ success: false, message: 'Order is ongoing.' });
        }

        await db('orders').where({ orderId }).update({ status: "completed", endTime: new Date() });
        // socket.emit("emit_to_chat_completed", {
        //     user: order?.userId,
        //     orderId: order?.orderId,
        // });

        callEvent("emit_to_chat_completed", {
            user: order?.userId,
            orderId: order?.orderId,
        });

        return res.status(200).json({ success: true, data: null, message: 'End chat successfully.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getRoom, getMessage, sendMessage, getDetail, getOrderDetail, endChat, forceEndChat };