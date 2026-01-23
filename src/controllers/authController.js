const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { validationResult } = require('express-validator');
const { encrypt } = require("../utils/crypto")
const { checkOrders, isValidMobile } = require('../utils/decodeJWT');
const axios = require('axios');
const { setCache } = require('../config/redisClient');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);

async function register(req, res) {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        const { username, email, password } = req.body;
        // check existing
        const existing = await db('users').where('email', email).orWhere('username', username).first();
        if (existing) return res.status(409).json({ message: 'User with that email or username already exists' });


        const hashed = await bcrypt.hash(password, SALT_ROUNDS);


        const [user] = await db('users').insert({ username, email, password: hashed }).returning(['id', 'username', 'email']);


        // create token
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });


        res.status(201).json({ user, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
}

async function login(req, res) {
    try {
        const { mobile, country_code = '+91' } = req.body;

        if (!mobile || !country_code) return res.status(400).json({ success: false, message: 'Mobile number required.' });
        const isValid = isValidMobile(mobile);
        if (!isValid) return res.status(400).json({ success: false, message: 'Enter valid mobile number.' });
        const user = await db('users').where({ country_code, mobile }).first();
        if (user && user?.status == 'block') {
            return res.status(400).json({ success: false, message: 'Your account is blocked.' });
        }
        const url = `http://pro.trinityservices.co.in/generateOtp.jsp?userid=${process.env.OTP_USERNAME}&key=${process.env.OTP_KEY}&mobileno=${mobile}&timetoalive=600&sms=%7Botp%7D%20is%20the%20one%20time%20password%20for%20Astroguruji%20Application.%20AstrotalkGuruji`
        let otpResponse;
        try {
            otpResponse = await axios.get(url);
            otpResponse = otpResponse.data
        } catch (error) {
            console.error('Acquire API failed:', error.message);
            otpResponse = null;
        }
        return res.status(200).json({ success: true, message: 'Otp Send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function verifyOtp(req, res) {
    try {
        const { mobile, country_code = '+91', otp } = req.body;
        if (!mobile || !otp || !country_code) return res.status(400).json({ success: false, message: 'Mobile number and otp required.' });

        const isValid = isValidMobile(mobile);
        if (!isValid) return res.status(400).json({ success: false, message: 'Enter valid mobile number.' });
        const url = `http://pro.trinityservices.co.in/validateOtpApi.jsp?mobileno=${mobile}&otp=${otp}`;
        let otpResponse;
        try {
            otpResponse = await axios.get(url);
            otpResponse = otpResponse.data
            if (otpResponse?.result != "success") {
                return res.status(400).json({ success: false, message: 'Wrong Otp' });
            }
        } catch (error) {
            console.error('Acquire API failed:', error.message);
            otpResponse = null;
        }

        let existing = await db('users').where({ mobile, country_code }).first();
        // if (!existing) return res.status(400).json({ success: false, message: 'Wrong Otp' });

        if (existing?.deleted_at != null) {
            await db('users').where({ id: existing?.id }).update({ deleted_at: null })
        }
        if (!existing) {
            [existing] = await db('users').insert({ mobile, country_code, status: "active" }).returning(['id', 'mobile', 'avatar', 'country_code', 'otp']);
        }
        const token = jwt.sign({ userId: existing.id, mobile: existing.mobile }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
        // hide password
        const encryptToken = encrypt(token);

        // Store token in Redis with key user_username (or user_mobile if username doesn't exist)
        const username = existing.id;
        const redisKey = `user_${username}`;
        // Set TTL to match JWT expiration (1 hour = 3600 seconds)
        const jwtExpiry = process.env.JWT_EXPIRES_IN || '1h';
        let ttlSeconds = 3600; // default 1 hour
        if (jwtExpiry.includes('h')) {
            ttlSeconds = parseInt(jwtExpiry.replace('h', '')) * 3600;
        }
        await setCache(redisKey, encryptToken, ttlSeconds);

        return res.status(200).json({ success: true, data: { id: existing?.id, name: existing?.name, profile: existing?.profile, avatar: existing?.avatar, mobile: existing?.mobile, country_code: existing?.country_code, token: encryptToken }, message: 'Otp Verify Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function socialUrl(req, res) {
    try {
        const { platform } = req.query
        if (!platform) return res.status(400).json({ success: false, message: 'Missing params' });
        const banner = await db('banners').where({ platform });
        const setting = await db('settings').first();
        const data = {
            banners: banner,
            socialUrl: setting
        }
        return res.status(200).json({ success: true, data, message: 'get config Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { register, login, verifyOtp, socialUrl };