const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const admin = require('../config/firebase');
const { replaceTemplate } = require('../utils/replaceTemplate');

async function sendBulkPush(tokens, title, body, data = {}) {
    // Normalize: allow single token string or array, filter invalid
    const list = Array.isArray(tokens) ? tokens : (tokens ? [tokens] : []);
    const validTokens = [...new Set(list)]
        .map((t) => (typeof t === 'string' ? t.trim() : t))
        .filter((t) => t && t.length > 0);
    if (validTokens.length === 0) {
        // console.log('sendBulkPush: no valid tokens');
        return;
    }
    const bodyStr = typeof body === 'string' ? body : '';
    const dataStr = typeof data === 'object' && data !== null
        ? Object.fromEntries(Object.entries(data).map(([k, v]) => [String(k), String(v)]))
        : {};
    const messages = validTokens.map((token) => ({
        token,
        notification: { title, body: bodyStr },
        data: dataStr,
    }));
    try {
        const response = await admin.messaging().sendEach(messages);
        // console.log('FCM Success:', response.successCount, 'Failed:', response.failureCount);
        if (response.failureCount > 0 && response.responses) {
            response.responses.forEach((r, i) => {
                if (r.error) {
                    console.log(`FCM fail[${i}] token: ${validTokens[i]?.slice(0, 20)}... code: ${r.error.code} message: ${r.error.message}`);
                }
            });
        }
    } catch (err) {
        console.error('sendBulkPush error:', err.code || err.message, err);
    }
}

async function addReview(req, res) {
    try {
        const { panditId, message, orderId, rating, hide } = req.body;
        if (!panditId || !rating) return res.status(400).json({ success: false, message: 'Missing params.' });
        const user = await db('reviews')
            .where('user_id', req?.userId)
            .where('order_id', orderId)
            .first();
        // console.log("user", user);
        // if (user) return res.status(400).json({ success: false, message: 'You already follow this pandit' });
        if (!user) {
            const [saved] = await db('pandits').where({ id: Number(panditId) }).increment(`rating_${rating}`, 1).returning("*");
            const userDetail = await db('users').where('id', req?.userId).first();
            await db('reviews').insert({ user_id: req?.userId, pandit_id: panditId, order_id: orderId, message, rating, type: "user", hide, gender: userDetail?.gender, profile: userDetail?.profile, avatar: userDetail?.avatar, name: userDetail?.name });
            if (saved?.token && rating == 5) {
                const template = await db('templates').where({ type: "pandit", status: "active", message_type: "5 Star Review" }).first();
                if (template) {
                    const title = replaceTemplate(template?.title);
                    const body = replaceTemplate(template?.desc, { user_name: userDetail?.name, message });
                    sendBulkPush([saved?.token], title, body, data = {})
                }
            }
        } else {
            await db('reviews').where({ id: user?.id }).update({ user_id: req?.userId, pandit_id: panditId, order_id: orderId, hide, message, rating });
        }
        return res.status(200).json({ success: true, message: 'Review added Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function addReplay(req, res) {
    try {
        const { ratingId, replay } = req.body;
        if (!ratingId || !replay) return res.status(400).json({ success: false, message: 'Please enter replay.' });
        const user = await db('reviews')
            .where('pandit_id', req?.userId)
            .where('id', ratingId)
            .first();
        // console.log("user", user);
        if (!user) return res.status(400).json({ success: false, message: 'You already follow this pandit' });
        if (user) {
            await db('reviews')
                .where('id', user?.id)
                .update({ replay });
        }
        return res.status(200).json({ success: true, message: 'Replay Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getList(req, res) {
    try {
        const { panditId } = req.query;
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;

        if (!panditId) return res.status(400).json({ success: false, message: 'Please enter pandit.' });
        const userDetail = await db('user').where({ id: Number(req.userId) })
        const user = await db('reviews as r')
            .leftJoin('pandits as p', 'p.id', 'r.pandit_id')
            .where('r.pandit_id', panditId)
            .select(
                'r.id',
                'r.message',
                'r.rating',
                'r.tag',
                'r.hide',
                'p.display_name as name',
                'p.profile'
            )
            .limit(limit)
            .offset(offset)
            .orderBy('id', 'desc');
        const [{ count }] = await db('reviews')
            .count('* as count').where('pandit_id', panditId);
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: user,
            userDetail: {
                name: userDetail?.name,
                profile: userDetail?.profile,
                avatar: userDetail?.avatar,
            }
        }
        return res.status(200).json({ success: true, data: response, message: 'Review get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getReviewDetail(req, res) {
    try {
        const { order_id } = req.query;

        if (!order_id) return res.status(400).json({ success: false, message: 'Missing params.' });
        // const user = await db('reviews')
        // .where('order_id', order_id).select('id', 'message', 'replay', 'rating').first();

        const reviews = await db('orders as o')
            .where('o.order_id', order_id)
            .leftJoin('pandits as p', 'p.id', 'o.pandit_id')
            .leftJoin('reviews as r', 'r.order_id', 'o.order_id') // change if column name differs
            .select(
                'o.id',
                'r.message',
                'r.rating',
                'o.pandit_id',
                'p.display_name as name',
                'p.profile',
                'o.order_id',
                'o.type',
                'o.rate',
                'o.status',
                'o.start_time',
                'o.end_time',
                'o.duration',
                'o.deduction'
            )
            .orderBy('r.id', 'desc')
            .first()


        return res.status(200).json({ success: true, data: reviews || {}, message: 'Review get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}


module.exports = { addReview, addReplay, getList, getReviewDetail };