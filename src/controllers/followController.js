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
        console.log("user", user);
        if (user) return res.status(400).json({ success: false, message: 'You already follow this pandit' });
        if (!user) {
            await db('follows').insert({ userId: req?.userId, panditId, type: "user" });
        }
        return res.status(200).json({ success: true, message: 'Follow Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { addFollow };