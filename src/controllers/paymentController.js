const db = require('../db');
require('dotenv').config();
const crypto = require('crypto-js');

async function addPayment(req, res) {
    try {
        const { amount } = req.body;
        if (!amount) return res.status(400).json({ success: false, message: 'Missing params.' });
        const user = await db('users')
            .where('id', req?.userId)
            .first();
        if (!user) return res.status(400).json({ success: false, message: 'User not found.' });
        const orderId = ((parseInt(crypto.lib.WordArray.random(16).toString(), 16) % 1e6) + '').padStart(15, '0');
        const utr = Math.floor(100000000 + Math.random() * 900000000).toString();
        await db('users').where({ id: user?.id }).increment({ balance: Number(amount) });
        await db('payments').insert({ user_id: req?.userId, transaction_id: orderId, utr, amount, status: "success", type: "recharge" });
        await db('balancelogs').insert({ user_id: req?.userId, message: "Purchase of AT-Money via razorpay", amount });
        return res.status(200).json({ success: true, message: 'Review added Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}



module.exports = { addPayment };