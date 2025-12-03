const db = require('../db');
require('dotenv').config();

async function getPandits(req, res) {
    const user = await db('pandits');
    console.log("user", user);
    return res.status(200).json({ success: true, data: user, message: 'Login success' });
}

async function signup(req, res) {
    try {
        const { mobile, countryCode } = req.body;
        if (!mobile || !countryCode) return res.status(400).json({ success: false, message: 'Mobile number required.' });
        const user = await db('otpmanages').where(function () {
            this.where('mobile', mobile);
        }).first();

        if (!user) {
            await db('otpmanages').insert({ mobile, countryCode, otp: '1234' });
        }
        return res.status(200).json({ success: true, message: 'Otp Send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function verifyOtp(req, res) {
    try {
        const { mobile, countryCode, otp } = req.body;
        if (!mobile || !countryCode || !otp) return res.status(400).json({ success: false, message: 'Mobile number and otp required.' });

        const existing = await db('otpmanages').where('mobile', mobile).where('otp', otp).first();
        if (!existing) return res.status(400).json({ success: false, message: 'Wrong Otp' });

        return res.status(200).json({ success: true, data: null, message: 'Otp Verify Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function onboard(req, res) {
    try {
        const { name, dob, gender, language, skill, isAndroid, email, mobile, countryCode } = req.body;
        if (!mobile || !countryCode) return res.status(400).json({ success: false, message: 'Mobile number required.' });
        const user = await db('onboardings').where(function () {
            this.where('mobile', mobile);
        }).first();
        if (user) return res.status(400).json({ message: 'Mobile number already exist.' });
        if (!user) {
            await db('onboardings').insert({ name, dob, gender, language: language ? JSON.stringify(language) : {}, skill: skill ? JSON.stringify(skill) : {}, isAndroid, email, mobile, countryCode }).returning(['id', 'mobile']);
        }
        return res.status(200).json({ success: true, message: 'Onboard Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getPandits, onboard, signup, verifyOtp };
