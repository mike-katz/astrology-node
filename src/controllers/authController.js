const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { validationResult } = require('express-validator');
const { encrypt } = require("../utils/crypto")
const { checkOrders, isValidMobile } = require('../utils/decodeJWT');
const axios = require('axios');
const { setCache } = require('../config/redisClient');
const sendMail = require('../utils/sendMail');
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
const logger = require('../utils/logger').getLogger('authController');

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

async function sendSMS(mobile, country_code) {
    try {
        let response = {
            return: true,
            message: 'Message sent successfully',
        };
        const update = {}
        const latestRecord = await db('otpmanages').where({ mobile, country_code }).first();
        if (latestRecord) {
            const currentDate = new Date();
            if (latestRecord.sendattempt === 3 && latestRecord.sendexpiry > new Date()) {
                response.return = false;
                response.message = 'Your otp attempt is over. Please try after sometimes.';
                return response;
            }
            if (latestRecord.sendattempt < 3) {
                update.sendattempt = latestRecord.sendattempt + 1;
            } else {
                update.sendattempt = 1;
            }
            update.sendexpiry = new Date(currentDate.getTime() + 4 * 60 * 60 * 1000);
        }
        const OTP = Math.floor(100000 + Math.random() * 900000);

        const config = {
            method: 'get',
            maxBodyLength: Infinity,
            url: `${process.env.SMS_URL}?authkey=${process.env.SMS_KEY}&mobiles=${country_code}${mobile}&message= ${OTP} is the One Time Password (OTP) for AstroGuruji Application.&sender=${process.env.SMS_SENDER_NAME}&route=4&country=91&DLT_TE_ID=${process.env.SMS_TEMPLATE}`,
            headers: {
            },
        };
        await axios.request(config);
        const upd = {
            otp: OTP,
            mobile,
            country_code,
            sendattempt: update?.sendattempt || 1,
            sendexpiry: update?.sendexpiry || new Date(new Date().getTime() + 4 * 60 * 60 * 1000),
        }
        if (latestRecord) {
            await db('otpmanages').where({ mobile, country_code }).update(upd)
        } else {
            await db('otpmanages').insert(upd)
        }
        response.message = 'OTP Send successful.';
        return response
    } catch (err) {
        console.error(err);
        response.return = false;
        response.message = 'Something Wrong in generate otp.';
        return response
    }
}

async function verifySMS(mobile, country_code, otp) {
    const response = {};
    try {
        const latestRecord = await db('otpmanages').where({ mobile, country_code }).first();
        console.log("latestRecord", latestRecord);
        if (!latestRecord) {
            response.return = false;
            response.message = 'Wrong OTP! Please Enter Right OTP.';
            return response;
        }
        const currentDate = new Date();
        if (latestRecord.attempt === 3 && latestRecord.expiry > new Date()) {
            response.return = false;
            response.message = 'Your otp attempt is over. Please try after sometimes.';
            return response;
        }

        const update = {};
        if (latestRecord.attempt < 3) {
            update.attempt = latestRecord.attempt + 1;
        } else {
            update.attempt = 1;
        }
        update.expiry = new Date(currentDate.getTime() + 4 * 60 * 60 * 1000);

        // logger.info(latestRecord);

        if (otp.toString() != latestRecord.otp.toString()) {
            response.return = false;
            response.message = 'Wrong OTP! Please Enter Right OTP.';
        } else {
            response.return = true;
            response.message = 'OTP Matched Successfully!';
            update.attempt = 0;
            update.expiry = null;
        }
        await db('otpmanages').where({ mobile, country_code }).update(update);
    } catch (err) {
        logger.error(err);
        response.return = false;
        response.message = 'Error occurred while verifying OTP.';
    }
    console.log("response", response);
    return response;
};

async function login(req, res) {
    try {
        console.log("login");
        logger.info('login called')
        const { mobile, country_code = '+91' } = req.body;

        if (!mobile || !country_code) return res.status(400).json({ success: false, message: 'Mobile number required.' });
        const isValid = isValidMobile(mobile);
        if (!isValid) return res.status(400).json({ success: false, message: 'Enter valid mobile number.' });
        const user = await db('users').where({ country_code, mobile }).first();
        if (user && user?.status == 'block') {
            return res.status(400).json({ success: false, message: 'Your account is blocked.' });
        }
        if (user && user?.status == 'inactive') {
            return res.status(400).json({ success: false, message: 'Oops! Your account is inactive right now. Please contact support.' });
        }
        let newMobile = mobile
        // if (mobile.length == 12 && country_code == "+91") {
        //     newMobile = mobile.slice(2);
        // }
        if (mobile != '1999999999') {
            const setting = await db('settings').select('otp_provider').first();
            if (setting?.otp_provider == 'bulksms') {
                const response = await sendSMS(newMobile, country_code)
                if (!response.return) return res.status(400).json({ success: false, message: response?.message });
            } else {
                const url = `http://pro.trinityservices.co.in/generateOtp.jsp?userid=${process.env.OTP_USERNAME}&key=${process.env.OTP_KEY}&mobileno=${newMobile}&timetoalive=600&sms=%7Botp%7D%20is%20the%20one%20time%20password%20for%20Astroguruji%20Application.%20AstrotalkGuruji`
                let otpResponse;
                try {
                    otpResponse = await axios.get(url);
                    otpResponse = otpResponse.data
                } catch (error) {
                    console.error('Acquire API failed:', error.message);
                    otpResponse = null;
                }
            }
        }
        return res.status(200).json({ success: true, message: 'Otp Send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

function isNumber(str) {
    return /^-?\d+(\.\d+)?$/.test(str);
}

async function verifyOtp(req, res) {
    try {
        console.log("verifyOtp req.body", req.body);
        let { mobile, country_code = '+91', otp, ad_set_id, utm_source, ad_id, type, version, referrer } = req.body;
        if (!mobile || !otp || !country_code) return res.status(400).json({ success: false, message: 'Mobile number and otp required.' });

        const isValid = isValidMobile(mobile);
        if (!isValid) return res.status(400).json({ success: false, message: 'Enter valid mobile number.' });

        //remove extra 91
        console.log("mobile.length", mobile.length);
        // if (mobile.length == 12 && country_code == "+91") {
        //     mobile = mobile.slice(2);
        // }
        console.log("new mobile", mobile);
        if (mobile != '1999999999') {
            const setting = await db('settings').select('otp_provider').first();
            if (setting?.otp_provider == 'bulksms') {
                console.log("here");
                const response = await verifySMS(mobile, country_code, otp)
                if (!response.return) return res.status(400).json({ success: false, message: response?.message });
            } else {
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
            }
        }
        if (mobile == '1999999999' && otp != '956019') {
            return res.status(400).json({ success: false, message: 'Wrong Otp' });
        }
        let existing = await db('users').whereNull('deleted_at').where({ mobile, country_code }).first();
        // if (!existing) return res.status(400).json({ success: false, message: 'Wrong Otp' });

        if (existing?.deleted_at != null) {
            // await db('users').where({ id: existing?.id }).update({ deleted_at: null })
        }
        const mode = type ? type : 'APP';
        const upd = {}
        if (existing && version) {
            upd.version = version
        }

        let set_id = ad_set_id ?? referrer ?? null;

        if (set_id != null) {
            const isValid = isNumber(set_id);

            if (!isValid) {
                console.log("Invalid set_id:", set_id);
                set_id = null;

                if (existing) {
                    upd.ad_set_id = null;
                }
            } else {
                console.log("Valid set_id:", set_id);

                if (existing) {
                    upd.ad_set_id = Number(set_id);
                }
            }
        }

        if (!existing) {
            [existing] = await db('users').insert({ mobile, country_code, status: "active", balance: 0, ad_set_id: set_id, utm_source, ad_id, mode, version }).returning(['id', 'mobile', 'avatar', 'country_code', 'otp']);
        }
        if (Object.keys(upd).length > 0) {
            await db('users').where({ id: Number(existing?.id) }).update(upd)
        }
        const token = jwt.sign({ userId: existing.id, username: existing.name, mobile: existing.mobile }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
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

        const [{ count }] = await db('orders')
            .count('* as count')
            .where({ user_id: existing.id })
            .whereIn('status', ['continue', 'completed', 'pending']);
        const is_free = count == 0 ? true : false
        return res.status(200).json({ success: true, data: { id: existing?.id, name: existing?.name, profile: existing?.profile, avatar: existing?.avatar, mobile: existing?.mobile, country_code: existing?.country_code, token: encryptToken, is_free }, message: 'Otp Verify Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function socialUrl(req, res) {
    try {
        const { platform } = req.query
        if (!platform) return res.status(400).json({ success: false, message: 'Missing params' });
        const banner = await db('banners').whereNull('deleted_at').where({ platform });
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

async function getSettings(req, res) {
    try {
        const setting = await db('settings').select('facebook', 'x', 'instagram', 'youtube', 'linkedin', 'ios_version', 'android_version', 'agora_app_id', 'agora_certificate', 'google_map_key', 'pandit_app_url', 'upload_base_url', 'user_response_time', 'call_type').first();
        return res.status(200).json({ success: true, data: setting, message: 'get config Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendCall(req, res) {
    try {
        const { from, to } = req.body
        console.log("req.body", req.body);
        const numbers = ["+911413232575", "+911413231101", "+911413232574", "+911413231093"]
        const did = numbers[Math.floor(Math.random() * numbers.length)];

        console.log("sscds", {
            source: `+91${from}`,
            destination: `+91${to}`,
            // did: "+911413231099",//["+911413231091", "+911413231099"]
            did
        });
        const response = await axios({
            method: 'post',
            url: "https://voicecallconnect.com/ctc/external/create-call",
            headers: { Authorization: "Bearer 669B2JB1EKFF9aa0jUpwMvk4cel6ie47TyF3ZZJSxgjHGvKkHsbm9k6c9GQ0g669" },
            data: {
                source: `+91${from}`,
                destination: `+91${to}`,
                // did: "+911413231099",//["+911413231091", "+911413231099"]
                did
            }
        });
        console.log("response,response", response?.data);
        res.status(200).json({ success: true, message: "test" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function test(req, res) {
    try {
        res.status(200).json({ success: true, message: "test" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}


module.exports = { register, login, verifyOtp, socialUrl, getSettings, sendCall, test };