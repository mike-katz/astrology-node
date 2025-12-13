const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

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
        return res.status(400).json({ error: 'Missing params' });
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
    const { panditId, orderId, message } = req.body;
    if (!panditId || !orderId || !message) {
        return res.status(400).json({ error: 'Missing params' });
    }
    try {
        const order = await db('orders').where({ userId: req.userId, orderId, panditId, status: "continue" }).first();
        if (!order) return res.status(400).json({ error: 'Order is completed.' });

        const [saved] = await db('chats').insert({
            sender_type: "user",
            sender_id: Number(req.userId),
            receiver_type: "pandit",
            orderId,
            receiver_id: Number(panditId),
            lastmessage: message,
            message,
            status: "send"
        }).returning('*');
        return res.status(200).json({ success: true, data: saved, message: 'Message send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getDetail(req, res) {
    const { panditId } = req.query;
    try {
        const order = await db('pandits').where({ id: panditId }).first();
        if (!order) return res.status(400).json({ error: 'Pandit not found.' });
        return res.status(200).json({ success: true, data: { id: panditId, name: order?.name, profile: order?.profile, isOnline: order?.isOnline }, message: 'Message send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getOrderDetail(req, res) {
    const { orderId } = req.query;
    try {
        if (!orderId) {
            return res.status(400).json({ error: 'Missing params' });
        }
        const orderexist = await db('orders').where({ userId: req.userId, orderId }).first();
        if (!orderexist) return res.status(400).json({ error: 'Wrong order. Please enter correct' });
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 50;

        if (page < 1) page = 1;
        if (limit < 1) limit = 50;
        const offset = (page - 1) * limit;
        const order = await db('chats').where({ orderId }).limit(limit)
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

module.exports = { getRoom, getMessage, sendMessage, getDetail, getOrderDetail };