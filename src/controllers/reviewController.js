const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function addReview(req, res) {
    try {
        const { panditId, message, rating } = req.body;
        if (!panditId || !message || !rating) return res.status(400).json({ success: false, message: 'Please select pandit.' });
        const user = await db('reviews')
            .where('userId', req?.userId)
            .where('panditId', panditId)
            .first();
        console.log("user", user);
        // if (user) return res.status(400).json({ success: false, message: 'You already follow this pandit' });
        if (!user) {
            await db('reviews').insert({ userId: req?.userId, panditId, message, rating, type: "user" });
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
            .where('panditId', req?.userId)
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

module.exports = { addReview, addReplay };