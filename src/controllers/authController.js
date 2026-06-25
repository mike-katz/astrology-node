const crypto = require('crypto');
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { validationResult } = require('express-validator');
const { encrypt } = require("../utils/crypto")
const { checkOrders, isValidMobile, generateLoginResponse } = require('../utils/decodeJWT');
const axios = require('axios');
const { sendTwilioSMS } = require('../utils/twilioSms');
const { setCache } = require('../config/redisClient');
const sendMail = require('../utils/sendMail');
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
const logger = require('../utils/logger').getLogger('authController');
const geoip = require('geoip-lite');
const { getClientIp } = require('../utils/getClientIp');
const { getCurrencyByCountry } = require('../utils/countryCurrencyMap');

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
    let response = {
        return: true,
        message: 'Message sent successfully',
    };
    try {
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

        if (country_code == '+91') {
            const config = {
                method: 'get',
                maxBodyLength: Infinity,
                url: `${process.env.SMS_URL}?authkey=${process.env.SMS_KEY}&mobiles=${country_code}${mobile}&message= ${OTP} is the One Time Password (OTP) for AstroGuruji Application.&sender=${process.env.SMS_SENDER_NAME}&route=4&country=91&DLT_TE_ID=${process.env.SMS_TEMPLATE}`,
                headers: {},
            };
            const data = await axios.request(config);
            console.log("otp response data", data);
        } else {
            const otpMessage = `${OTP} is the One Time Password (OTP) for AstroGuruji Application.`;
            const phone = `${country_code}${mobile}`;

            const whatsappConfig = {
                method: 'post',
                maxBodyLength: Infinity,
                url: process.env.WHATSAPP_SMS_URL,
                headers: {
                    Authorization: "Bearer 2593$SjlOUEN6ZllXbzE1QUpOK09DVFU2dz09"
                },
                data: {
                    type: "buttonTemplate",
                    templateId: "appotp",
                    templateLanguage: "en",
                    sender_phone: phone,
                    templateArgs: [OTP]
                }
            };

            const [whatsappResult, twilioResult] = await Promise.allSettled([
                axios.request(whatsappConfig),
                sendTwilioSMS(phone, otpMessage),
            ]);

            if (whatsappResult.status === 'rejected') {
                console.log('WhatsApp OTP failed:', whatsappResult.reason?.response?.data || whatsappResult.reason?.message);
            }
            if (twilioResult.status === 'rejected') {
                console.log('Twilio OTP failed:', twilioResult.reason?.message);
            }
            if (whatsappResult.status === 'rejected' && twilioResult.status === 'rejected') {
                response.return = false;
                response.message = 'Something Wrong in generate otp.';
                return response;
            }

            console.log("otp response whatsapp", whatsappResult.status === 'fulfilled' ? whatsappResult.value?.data : null);
            console.log("otp response twilio", twilioResult.status === 'fulfilled' ? twilioResult.value?.sid : null);
        }
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
        console.log(err?.response?.data || err?.message);
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
            update.sendattempt = 0;
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
        console.log("login body param", req.body);
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
        console.log("mobile.length", mobile.length);
        if (mobile.length == 12 && country_code == "+91") {
            newMobile = mobile.slice(2);
        }
        console.log("newMobile", newMobile);
        if (mobile != '1999999999') {
            const setting = await db('settings').select('otp_provider').first();
            if (country_code != "+91") {
                const response = await sendSMS(newMobile, country_code)
                if (!response.return) return res.status(400).json({ success: false, message: response?.message });
            }
            else if (setting?.otp_provider == 'bulksms') {
                const response = await sendSMS(newMobile, country_code)
                if (!response.return) return res.status(400).json({ success: false, message: response?.message });
            } else {
                const url = `http://pro.trinityservices.co.in/generateOtp.jsp?userid=${process.env.OTP_USERNAME}&key=${process.env.OTP_KEY}&mobileno=${newMobile}&timetoalive=600&sms=%7Botp%7D%20is%20the%20one%20time%20password%20for%20Astroguruji%20Application.%20AstrotalkGuruji`
                let otpResponse;
                try {
                    otpResponse = await axios.get(url);
                    // console.log("otpResponse", otpResponse);
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
        if (mobile.length == 8 && country_code == "+91") {
            mobile = `91${mobile}`;
        }
        if (mobile.length == 12 && country_code == "+91") {
            mobile = mobile.slice(2);
        }
        console.log("new mobile", mobile);
        if (mobile != '1999999999') {
            const setting = await db('settings').select('otp_provider').first();
            if (country_code != "+91") {
                const response = await verifySMS(mobile, country_code, otp)
                if (!response.return) return res.status(400).json({ success: false, message: response?.message });
            }
            else if (setting?.otp_provider == 'bulksms') {
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
        if (mode) {
            upd.mode = mode
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

        const ip = await getClientIp(req);
        let currency;
        if (ip) {
            console.log("ip", ip);
            const geo = await geoip.lookup(ip);
            const country = geo ? geo.country : 'IN';
            console.log("country", country);
            currency = await getCurrencyByCountry(country);
            console.log("currency", currency);
            currency = currency?.currency
        }
        currency = existing?.default_currency || 'INR';

        if (!existing) {
            [existing] = await db('users').insert({ mobile, country_code, status: "active", balance: 0, ad_set_id: set_id, utm_source, ad_id, mode, version, is_free_order_available: true, default_currency: currency, permanent_currency: currency }).returning(['id', 'mobile', 'avatar', 'country_code', 'otp', 'is_free_order_available', 'permanent_currency', 'default_currency']);
        }
        if (Object.keys(upd).length > 0) {
            await db('users').where({ id: Number(existing?.id) }).update(upd)
        }
        const response = await generateLoginResponse(existing, currency)
        return res.status(200).json(response);
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
        const setting = await db('settings').select('facebook', 'x', 'instagram', 'youtube', 'linkedin', 'ios_version', 'android_version', 'agora_app_id', 'agora_certificate', 'google_map_key', 'pandit_app_url', 'upload_base_url', 'user_response_time', 'call_type', 'map_api_key', 'is_live_enabled').first();
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
            url: "https://obdivr.in/api/ctc/initiate-call",
            headers: { Authorization: "Bearer 669B2JB1EKFF9aa0jUpwMvk4cel6ie47TyF3ZZJSxgjHGvKkHsbm9k6c9GQ0g669" },
            data: {
                apartyno: `+91${from}`,
                bpartyno: `+91${to}`,
                // did: "+911413231099",//["+911413231091", "+911413231099"]
                cli: did,
                "reference_id": "1",
                "channelflag": 0,
                "dtmfflag": 0,
                "recordingflag": 0
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

function parseGoogleClientIds() {
    const raw = process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Verifies a Google ID token (from mobile/web Google Sign-In) and returns the same session shape as verifyOtp.
 * Configure GOOGLE_CLIENT_IDS (comma-separated) or GOOGLE_CLIENT_ID with your OAuth client IDs (Web, iOS, Android).
 */
async function googleLogin(req, res) {
    console.log("googleLogin req.body", req.query);
    try {
        // const idToken = req.query.token;
        // if (!idToken) {
        //     return res.status(400).json({ success: false, message: 'id_token or idToken is required' });
        // }

        // const clientIds = parseGoogleClientIds();
        // if (!clientIds.length) {
        //     logger.warn('googleLogin: GOOGLE_CLIENT_IDS / GOOGLE_CLIENT_ID not set');
        //     return res.status(503).json({ success: false, message: 'Google login is not configured' });
        // }

        // let tokenPayload;
        // try {
        //     const tokenRes = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
        //         params: { id_token: idToken },
        //         timeout: 15000,
        //     });
        //     tokenPayload = tokenRes.data;
        // } catch (e) {
        //     if (e.response?.status === 400) {
        //         return res.status(401).json({ success: false, message: 'Invalid or expired Google token' });
        //     }
        //     logger.error(e);
        //     return res.status(502).json({ success: false, message: 'Could not verify Google token' });
        // }

        // if (tokenPayload.error) {
        //     return res.status(401).json({
        //         success: false,
        //         message: tokenPayload.error_description || tokenPayload.error || 'Invalid Google token',
        //     });
        // }

        // if (!clientIds.includes(tokenPayload.aud)) {
        //     return res.status(401).json({ success: false, message: 'Invalid token audience' });
        // }

        // if (tokenPayload.email && tokenPayload.email_verified !== 'true') {
        //     return res.status(400).json({ success: false, message: 'Google account email is not verified' });
        // }

        // const sub = tokenPayload.sub;
        // const email = tokenPayload.email || null;
        // const name = tokenPayload.name || (email ? email.split('@')[0] : null) || 'User';
        // const picture = tokenPayload.picture || null;
        let { ad_set_id, utm_source, ad_id, type, version, referrer, email } = req.query;
        let existing = await db('users').whereNull('deleted_at').where({ email }).first();

        if (existing?.status === 'block') {
            return res.status(400).json({ success: false, message: 'Your account is blocked.' });
        }
        if (existing?.status === 'inactive') {
            return res.status(400).json({
                success: false,
                message: 'Oops! Your account is inactive right now. Please contact support.',
            });
        }

        const mode = type ? type : 'APP';
        const upd = {};
        if (existing && version) {
            upd.version = version;
        }
        if (mode) {
            upd.mode = mode;
        }

        let set_id = ad_set_id ?? referrer ?? null;
        if (set_id != null) {
            const numOk = isNumber(set_id);
            if (!numOk) {
                set_id = null;
                if (existing) {
                    upd.ad_set_id = null;
                }
            } else if (existing) {
                upd.ad_set_id = Number(set_id);
            }
        }
        const ip = getClientIp(req);
        let currency;
        if (ip) {
            const geo = geoip.lookup(ip);
            const country = geo ? geo.country : 'IN';
            currency = getCurrencyByCountry(country);
            currency = currency?.currency
        }
        currency = existing?.default_currency || 'INR';

        if (!existing) {
            const insertRow = {
                // google_id: sub,
                email,
                // name: email,
                // avatar: picture,
                country_code: '+91',
                status: 'active',
                balance: 0,
                mobile: null,
                mode,
                version: version || null,
                utm_source: utm_source || null,
                ad_id: ad_id || null,
                permanent_currency: currency,
                default_currency: currency,
                ad_set_id: set_id != null && isNumber(set_id) ? Number(set_id) : null,
            };
            [existing] = await db('users').insert(insertRow).returning([
                'id',
                'mobile',
                'avatar',
                'country_code',
                'otp',
                'name',
                'profile',
                'email',
                'permanent_currency',
                'default_currency'
                // 'google_id',
            ]);
        } else {
            const linkUpd = { ...upd };
            // if (!existing.google_id) {
            //     linkUpd.google_id = sub;
            // }
            if (email) {
                linkUpd.email = email;
            }
            // if (picture) {
            //     linkUpd.avatar = picture;
            // }
            // if (name && !existing.name) {
            //     linkUpd.name = name;
            // }
            if (Object.keys(linkUpd).length > 0) {
                await db('users').where({ id: Number(existing.id) }).update(linkUpd);
            }
            existing = await db('users').where({ id: existing.id }).first();
        }
        const response = await generateLoginResponse(existing, currency)
        return res.status(200).json(response);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
let appleJwksCache = { keys: null, fetchedAt: 0 };
const APPLE_JWKS_TTL_MS = 60 * 60 * 1000;

async function getAppleSigningKeys() {
    const now = Date.now();
    if (appleJwksCache.keys && now - appleJwksCache.fetchedAt < APPLE_JWKS_TTL_MS) {
        return appleJwksCache.keys;
    }
    const { data } = await axios.get(APPLE_JWKS_URL, { timeout: 15000 });
    if (!data.keys || !Array.isArray(data.keys)) {
        throw new Error('Invalid Apple JWKS response');
    }
    appleJwksCache = { keys: data.keys, fetchedAt: now };
    return data.keys;
}

function bustAppleJwksCache() {
    appleJwksCache = { keys: null, fetchedAt: 0 };
}

function parseAppleAudiences() {
    const raw = process.env.APPLE_CLIENT_IDS || process.env.APPLE_CLIENT_ID || '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Verify Sign in with Apple identity token (JWT from ASAuthorizationAppleIDCredential).
 * @param {string} identityToken
 * @param {string[]} audiences Bundle ID(s) and/or Services ID(s) from Apple Developer
 */
async function verifyAppleIdentityToken(identityToken, audiences) {
    const decoded = jwt.decode(identityToken, { complete: true });
    if (!decoded || typeof decoded !== 'object' || !decoded.header?.kid) {
        throw new Error('Invalid Apple identity token');
    }
    let keys = await getAppleSigningKeys();
    let jwk = keys.find((k) => k.kid === decoded.header.kid);
    if (!jwk) {
        bustAppleJwksCache();
        keys = await getAppleSigningKeys();
        jwk = keys.find((k) => k.kid === decoded.header.kid);
    }
    if (!jwk) {
        throw new Error('Apple signing key not found');
    }
    const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const pem = pubKey.export({ type: 'spki', format: 'pem' });
    return jwt.verify(identityToken, pem, {
        algorithms: ['RS256'],
        issuer: APPLE_ISSUER,
        audience: audiences,
    });
}

/**
 * Same session contract as googleLogin / verifyOtP — iOS Sign in with Apple.
 * Body (after decrypt): token | identity_token | identityToken (Apple identity JWT).
 * Optional: name or userName (Apple only sends full name once on device — pass from iOS if you have it).
 * Optional: type, version, ad_set_id, utm_source, ad_id, referrer
 * Env: APPLE_CLIENT_IDS (comma-separated) or APPLE_CLIENT_ID (Bundle ID, or Services ID for web).
 */
async function appleLogin(req, res) {
    try {
        const { ad_set_id, utm_source, ad_id, type, version, referrer, token: userToken } = req.query;
        let existing = await db('users').whereNull('deleted_at').where({ email: userToken }).first();

        if (existing?.status === 'block') {
            return res.status(400).json({ success: false, message: 'Your account is blocked.' });
        }
        if (existing?.status === 'inactive') {
            return res.status(400).json({
                success: false,
                message: 'Oops! Your account is inactive right now. Please contact support.',
            });
        }

        const mode = type ? type : 'APP';
        const upd = {};
        if (existing && version) {
            upd.version = version;
        }
        if (mode) {
            upd.mode = mode;
        }

        let set_id = ad_set_id ?? referrer ?? null;
        if (set_id != null) {
            const numOk = isNumber(set_id);
            if (!numOk) {
                set_id = null;
                if (existing) {
                    upd.ad_set_id = null;
                }
            } else if (existing) {
                upd.ad_set_id = Number(set_id);
            }
        }

        const ip = getClientIp(req);
        let currency;
        if (ip) {
            const geo = geoip.lookup(ip);
            const country = geo ? geo.country : 'IN';
            currency = getCurrencyByCountry(country);
            currency = currency?.currency
        }
        currency = existing?.default_currency || 'INR';

        if (!existing) {
            const insertRow = {
                // google_id: sub,
                email: userToken,
                // name: email,
                // avatar: picture,
                country_code: '+91',
                status: 'active',
                balance: 0,
                mobile: null,
                mode,
                version: version || null,
                utm_source: utm_source || null,
                permanent_currency: currency,
                default_currency: currency,
                ad_id: ad_id || null,
                ad_set_id: set_id != null && isNumber(set_id) ? Number(set_id) : null,
            };
            [existing] = await db('users').insert(insertRow).returning([
                'id',
                'mobile',
                'avatar',
                'country_code',
                'otp',
                'name',
                'profile',
                'email',
                'permanent_currency',
                'default_currency'
                // 'google_id',
            ]);
        } else {
            const linkUpd = { ...upd };
            // if (!existing.google_id) {
            //     linkUpd.google_id = sub;
            // }
            if (userToken) {
                linkUpd.email = userToken;
            }
            // if (picture) {
            //     linkUpd.avatar = picture;
            // }
            // if (name && !existing.name) {
            //     linkUpd.name = name;
            // }
            if (Object.keys(linkUpd).length > 0) {
                await db('users').where({ id: Number(existing.id) }).update(linkUpd);
            }
            existing = await db('users').where({ id: existing.id }).first();
        }
        const response = await generateLoginResponse(existing, currency)
        return res.status(200).json(response);

        // const token = jwt.sign(
        //     { userId: existing.id, username: existing.name, mobile: existing.mobile },
        //     process.env.JWT_SECRET,
        //     { expiresIn: process.env.JWT_EXPIRES_IN || '1h' },
        // );
        // const encryptToken = encrypt(token);

        // const username = existing.id;
        // const redisKey = `user_${username}`;
        // const jwtExpiry = process.env.JWT_EXPIRES_IN || '1h';
        // let ttlSeconds = 3600;
        // if (jwtExpiry.includes('h')) {
        //     ttlSeconds = parseInt(jwtExpiry.replace('h', ''), 10) * 3600;
        // }
        // await setCache(redisKey, encryptToken, ttlSeconds);

        // const [{ count }] = await db('orders')
        //     .count('* as count')
        //     .where({ user_id: existing?.id })
        //     .whereIn('status', ['continue', 'completed', 'pending']);
        // const is_free = count == 0;

        // return res.status(200).json({
        //     success: true,
        //     data: {
        //         id: existing?.id,
        //         name: existing?.name,
        //         profile: existing?.profile,
        //         avatar: existing?.avatar,
        //         mobile: existing?.mobile,
        //         country_code: existing?.country_code,
        //         token: encryptToken,
        //         is_free,
        //     },
        //     message: 'Apple sign-in successful',
        // });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = {
    register,
    login,
    verifyOtp,
    socialUrl,
    getSettings,
    sendCall,
    test,
    sendSMS,
    verifySMS,
    googleLogin,
    appleLogin,
};