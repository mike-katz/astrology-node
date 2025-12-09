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
        res.status(500).json({ error: 'Server error', details: err.message });
    }
}

async function getMessage(req, res) {
    const { me_type, me_id, other_type, other_id, limit = 50, offset = 0 } = req.query;
    if (!me_type || !me_id || !other_type || !other_id) {
        return res.status(400).json({ error: 'Missing params' });
    }

    try {
        const messages = await db('chats')
            .where(function () {
                this.where({ sender_type: me_type, sender_id: me_id, receiver_type: other_type, receiver_id: other_id })
                    .orWhere({ sender_type: other_type, sender_id: other_id, receiver_type: me_type, receiver_id: me_id });
            })
            .orderBy('created_at', 'asc')
            .limit(limit)
            .offset(offset);

        // Mark messages received by me as read
        await db('chats')
            .where({ receiver_type: me_type, receiver_id: me_id, sender_type: other_type, sender_id: other_id, is_read: false })
            .update({ is_read: true });
        return res.status(200).json({ success: true, data: messages, message: 'Chat get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
}

module.exports = { getRoom, getMessage };