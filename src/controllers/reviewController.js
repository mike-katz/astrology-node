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
        const reviews = await db('reviews as r')
            .where('r.pandit_id', panditId)
            .leftJoin('pandits as p', 'p.id', 'r.pandit_id')
            .leftJoin('orders as o', 'o.id', 'r.order_id') // change if column name differs
            .select(
                'r.id',
                'r.message',
                'r.rating',
                'r.pandit_id',
                'p.name',
                'p.profile',
                'o.order_id',
                'o.type',
                'o.rate',
                'o.start_time',
                'o.end_time',
                'o.duration',
                'o.deduction'
            )
            .limit(limit)
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
            results: reviews
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
        const user = await db('reviews')
            .left
            .where('order_id', order_id).select('id', 'message', 'replay', 'rating').first();

        return res.status(200).json({ success: true, data: user, message: 'Review get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}


module.exports = { addReview, addReplay, getList, getReviewDetail };