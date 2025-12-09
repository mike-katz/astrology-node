const db = require('../db');
require('dotenv').config();
const crypto = require('crypto-js');

async function create(req, res) {
    const { panditId } = req.body;

    if (!panditId) {
        return res.status(400).json({ success: false, message: 'Please enter pandit' });
    }
    try {
        const user = await db('users').where({ id: req.userId }).first()
        if (user?.balance < 1) return res.status(400).json({ success: false, message: 'Please recharge your wallet.' });

        const pandit = await db('pandits').where({ id: panditId }).first()
        if (!pandit) return res.status(400).json({ success: false, message: 'Pandit not found.' });
        const order = await db('orders').where({ userId: req.userId, panditId }).first()
        const orderId = ((parseInt(crypto.lib.WordArray.random(16).toString(), 16) % 1e6) + '').padStart(15, '0');
        let deduction = 0
        if (!order) {
            //create 5 minute order
            deduction = (5 * pandit?.charge || 1);

        } else {
            deduction = (1 * pandit?.charge || 1);
        }
        if (user?.balance < deduction) return res.status(400).json({ success: false, message: 'Insufficient fund.' });
        await db('orders').insert({
            panditId,
            userId: req.userId,
            orderId,
            status: "pending",
            rate: pandit?.charge || 1,
            duration: 5,
            deduction
        })
        return res.status(200).json({ success: true, data: null, message: 'Order create Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function list(req, res) {    try {        const order = await db('orders').where({ userId: req.userId }).orderByRaw(`            CASE status            WHEN 'continue' THEN 1            WHEN 'pending' THEN 2            WHEN 'completed' THEN 3            ELSE 4            END        `);        return res.status(200).json({ success: true, data: order, message: 'Order create Successfully' });    } catch (err) {        console.error(err);        res.status(500).json({ success: false, message: 'Server error' });    }}module.exports = { create, list };