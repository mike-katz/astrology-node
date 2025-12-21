const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function addFollow(req, res) {
    try {
        const { panditId } = req.body;
        if (!panditId) return res.status(400).json({ success: false, message: 'Please select pandit.' });
        const user = await db('follows')
            .where('user_id', req?.userId)
            .where('pandit_id', panditId)
            .where('type', 'user')
            .first();
        if (user) {
            await db('follows')
                .where({
                    user_id: req?.userId,
                    pandit_id: panditId,
                    type: "user"
                })
                .del();
            return res.status(400).json({ success: false, message: 'UnFollow successful' });
        }
        if (!user) {
            await db('follows').insert({ user_id: req?.userId, pandit_id: panditId, type: "user" });
        }
        return res.status(200).json({ success: true, message: 'Follow Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFollow(req, res) {

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;

    if (page < 1) page = 1;
    if (limit < 1) limit = 100;
    const offset = (page - 1) * limit;

    const user = await db('follows as f')
        .leftJoin('pandits as p', 'p.id', 'f.pandit_id')
        .select(
            "f.created_at",
            "p.id",
            "p.charge",
            "p.name",
            "p.profile",
            "p.knowledge",
            "p.language",
            "p.experience",
        )
        .where('f.user_id', Number(req?.userId)).limit(limit)
        .offset(offset);
    const [{ count }] = await db('follows')
        .count('* as count').where('user_id', Number(req?.userId));

    const total = parseInt(count);
    const totalPages = Math.ceil(total / limit);

    const response = {
        page,
        limit,
        total,
        totalPages,
        results: user
    }
    return res.status(200).json({ success: true, data: response, message: 'Follow get Successfully' });
}

module.exports = { addFollow, getFollow };