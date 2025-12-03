const db = require('../db');
require('dotenv').config();

async function getPandits(req, res) {
    const user = await db('pandits');
    console.log("user", user);
    return res.status(200).json({ data: user, message: 'Login success' });
}

async function signup(req, res) {
    try {
        const { mobile, countryCode } = req.body;
        if (!mobile || !countryCode) return res.status(400).json({ success: false, message: 'Mobile number required.' });
        const user = await db('pandits').where(function () {
            this.where('mobile', mobile);
        }).first();

        if (!user) {
            await db('pandits').insert({ mobile, countryCode, otp: '1234' }).returning(['id', 'mobile', 'otp']);
        }
        return res.status(200).json({ success: true, message: 'Otp Send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getPandits, signup };
