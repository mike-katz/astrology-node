const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function addFollow(req, res) {
    try {
        const { panditId } = req.body;
        if (!panditId) return res.status(400).json({ success: false, message: 'Please select pandit.' });
        const user = await db('follows')
            .where('userId', req?.userId)
            .where('panditId', panditId)
            .where('type', 'user')
            .first();
        if (user) {
            await db('follows')
                .where({
                    userId: req?.userId,
                    panditId,
                    type: "user"
                })
                .del();
            return res.status(400).json({ success: false, message: 'UnFollow successful' });
        }
        if (!user) {
            await db('follows').insert({ userId: req?.userId, panditId, type: "user" });
        }
        return res.status(200).json({ success: true, message: 'Follow Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFollow(req, res) {
    const user = await db('follows as f')
        .leftJoin('pandits as p', 'p.id', 'f.panditId')
        .select(
            "f.created_at",
            "p.name",
            "p.profile",
            "p.knowledge",
            "p.language",
            "p.experience",
        )
        .where('f.userId', req?.userId);
    return res.status(200).json({ success: true, data: user, message: 'Follow get Successfully' });
}

module.exports = { addFollow, getFollow };