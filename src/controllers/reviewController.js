const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function addReview(req, res) {
    try {
        const { panditId, message, orderId, rating } = req.body;
        if (!panditId || !rating) return res.status(400).json({ success: false, message: 'Missing params.' });
        const user = await db('reviews')
            .where('user_id', req?.userId)
            .where('order_id', orderId)
            .first();
        console.log("user", user);
        // if (user) return res.status(400).json({ success: false, message: 'You already follow this pandit' });
        if (!user) {
            await db('reviews').insert({ user_id: req?.userId, pandit_id: panditId, order_id: orderId, message, rating, type: "user" });
        } else {
            await db('reviews').where({ id: user?.id }).update({ user_id: req?.userId, pandit_id: panditId, order_id: orderId, message, rating });
        }
        return res.status(200).json({ success: true, message: 'Review Successfully' });
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
        console.log("user", user);
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
        const user = await db('reviews')
            .where('pandit_id', panditId).select('id', 'message', 'rating').limit(limit)
            .offset(offset);

        const [{ count }] = await db('reviews')
            .count('* as count').where('pandit_id', panditId);
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: user
        }
        return res.status(200).json({ success: true, data: response, message: 'Review get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { addReview, addReplay, getList };