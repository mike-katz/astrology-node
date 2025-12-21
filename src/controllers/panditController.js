const db = require('../db');
const { decrypt } = require('../utils/crypto');
require('dotenv').config();
const { uploadImageTos3 } = require('./uploader');
const jwt = require('jsonwebtoken');

async function getPandits(req, res) {

    let page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;

    if (page < 1) page = 1;
    if (limit < 1) limit = 100;
    const offset = (page - 1) * limit;
    const { type = "chat" } = req.query;

    const filter = {
        "p.status": "active",
    }
    const user = await db('pandits as p')
        .leftJoin('reviews as r', 'p.id', 'r.pandit_id')
        .select(
            'p.name',
            'p.id',
            'p.knowledge',
            'p.language',
            'p.experience',
            'p.profile',
            'p.available_for',
            'p.charge',
            db.raw(`
            COALESCE(
              json_agg(
                json_build_object(
                  'id', r.id,
                  'rating', r.rating,
                  'message', r.message
                )
              ) FILTER (WHERE r.id IS NOT NULL),
              '[]'
            ) AS reviews
          `)
        ).where(filter)
        .andWhere(function () {
            if (type === 'call') {
                this.where('p.call', true);
            }
            if (type === 'chat') {
                this.where('p.chat', true);
            }
            // ✅ OR condition
            this.orWhere('p.unlimited_free_calls_chats', true);
        })
        .groupBy('p.id')
        .limit(limit)
        .offset(offset);
    const [{ count }] = await db('pandits as p')
        .count('* as count').where(filter);

    const total = parseInt(count);
    const totalPages = Math.ceil(total / limit);

    const response = {
        page,
        limit,
        total,
        totalPages,
        results: user
    }
    return res.status(200).json({ success: true, data: response, message: 'List success' });
}

async function getPanditDetail(req, res) {
    const { id } = req.query;
    const user = await db('pandits').where('id', id).first();
    if (!user) return res.status(400).json({ success: false, message: 'pandit not available.' });
    const review = await db('reviews as r')
        .leftJoin('users as u', 'u.id', 'r.user_id')
        .select(
            "r.id",
            "r.message",
            "r.rating",
            "r.replay",
            "r.created_at",
            "u.name",
            "u.profile",
        )
        .where('r.pandit_id', id)
        .orderBy('r.created_at', 'desc')
        .limit(3);

    const response = {
        id: user?.id,
        name: user?.name,
        knowledge: user?.knowledge,
        language: user?.language,
        experience: user?.experience,
        profile: user?.profile,
        availableFor: user?.availableFor,
        charge: user?.charge,
        isverified: user?.isverified,
        reviews: review,
        isFollow: false
    }
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decryptToken = decrypt(token);
        const verified = jwt.verify(decryptToken, process.env.JWT_SECRET);
        if (verified?.userId) {
            const user = await db('follows').where({ 'pandit_id': id, 'user_id': verified?.userId }).first();
            console.log("user", user);
            if (user) {
                response.isFollow = true
            }
        }
    }

    return res.status(200).json({ success: true, data: response, message: 'Detail success' });
}

async function signup(req, res) {
    try {
        const { mobile, countryCode } = req.body;
        if (!mobile || !countryCode) return res.status(400).json({ success: false, message: 'Mobile number required.' });
        const user = await db('otpmanages').where(function () {
            this.where('mobile', mobile);
        }).first();

        if (!user) {
            await db('otpmanages').insert({ mobile, country_code: countryCode, otp: '1234' });
        }
        return res.status(200).json({ success: true, message: 'Otp Send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function verifyOtp(req, res) {
    const response = {};
    try {
        const { mobile, countryCode, otp } = req.body;
        if (!mobile || !countryCode || !otp) return res.status(400).json({ success: false, message: 'Mobile number and otp required.' });

        const latestRecord = await db('otpmanages').where('mobile', mobile).first();
        if (!latestRecord) return res.status(400).json({ success: false, message: 'Wrong Otp' });

        const currentDate = new Date();
        if (latestRecord.attempt === 3 && latestRecord.expiry > new Date()) {
            response.return = false;
            response.message = 'Your otp attempt is over. Please try after sometimes.';
            return res.status(400).json({ success: false, data: null, message: response?.message });
        }
        const update = {};
        if (latestRecord.attempt < 3) {
            update.attempt = latestRecord.attempt + 1;
        } else {
            update.attempt = 1;
        }
        if (otp == latestRecord?.otp) {
            update.expiry = new Date(currentDate.getTime() + 4 * 60 * 60 * 1000);
            await db('otpmanages')
                .where('id', latestRecord?.id)
                .update(update);
            return res.status(400).json({ success: false, data: null, message: 'Wrong otp' });
        }

        response.return = true;
        response.message = 'OTP Matched Successfully!';

        update.attempt = 0;
        update.expiry = null;

        await db('otpmanages')
            .where('id', latestRecord?.id)
            .update(update);

        return res.status(200).json({ success: true, data: null, message: 'Otp Verify Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

function is18OrAbove(dobString) {
    const dob = new Date(dobString);
    const today = new Date();

    const age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    const dayDiff = today.getDate() - dob.getDate();

    // If birthday hasn't occurred yet this year, subtract 1 age
    const realAge = (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0))
        ? age - 1
        : age;

    return realAge >= 18;
}

async function onboard(req, res) {
    try {
        const { name, dob, gender, phone_type, email, mobile, countryCode, languages, skills } = req.body;
        if (!mobile || !countryCode || !dob) return res.status(400).json({ success: false, message: 'Mobile number required.' });

        const isAbove18 = is18OrAbove(dob)
        if (!isAbove18) return res.status(400).json({ success: false, message: 'You are not a 18+ year.' });
        const skill = ["signature_reading", "vedic", "tarot", "kp", "numerology", "lal_kitab", "psychic", "palmistry", "cartomancy", "prashana", "loshu_grid", "nadi", "face_reading", "horary", "life_coach", "western", "gemology", "vastu"]

        const language = ["english", "hindi", "tamil", "panjabi", "marathi", "gujarati", "bangali", "french", "odia", "telugu", "kannada", "malayalam", "sanskrit", "assamese", "german", "spanish", "marwari", "manipuri", "urdu", "sindhi", "kashmiri", "bodo", "nepali", "konkani", "maithili", "arabic", "bhojpuri", "dutch", "rajasthanii"]

        const selected = languages.split(",").map(l => l.trim());  // ["english", "hindi"]

        const isValidLanguage = selected.every(l => language.includes(l));

        const selectedskill = skills.split(",").map(l => l.trim());  // ["english", "hindi"]

        const isValidSkill = selectedskill.every(l => skill.includes(l));

        if (!isValidLanguage) return res.status(400).json({ success: false, message: 'enter valid languages.' });
        if (!isValidSkill) return res.status(400).json({ success: false, message: 'enter valid skills.' });
        const user = await db('onboardings').where(function () {
            this.where('mobile', mobile);
        }).first();
        if (user) return res.status(400).json({ message: 'Mobile number already exist.' });
        // profile_image
        const { file } = req
        const ins = { name, dob, status: "pending", gender, email, mobile, country_code: countryCode }

        if (phone_type) {
            const selected = phone_type.split(",").map(l => l.trim());
            ins.phone_type = phone_type ? JSON.stringify(selected) : {}
        }
        if (Array.isArray(selected) && selected?.length > 0) {
            ins.language = selected ? JSON.stringify(selected) : {}
        }
        if (Array.isArray(selectedskill) && selectedskill?.length > 0) {
            ins.skill = selectedskill ? JSON.stringify(selectedskill) : {}
        }

        if (file) {
            const image = await uploadImageTos3('profile_image', file, 'pandit');
            console.log("image", image.data.Location);
            ins.profile_image = image.data.Location;
        }
        if (!user) {
            await db('onboardings').insert(ins).returning(['id', 'mobile']);
        }
        return res.status(200).json({ success: true, message: 'Onboard Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function reSendOtp(req, res) {
    try {
        const { mobile, countryCode } = req.body;
        if (!mobile || !countryCode) return res.status(400).json({ success: false, message: 'Mobile number required.' });

        const latestRecord = await db('otpmanages').where('mobile', mobile).where('country_code', countryCode).first();
        const update = {};
        let response = {
            return: true,
            message: 'Message sent successfully',
        };
        if (latestRecord) {
            const currentDate = new Date();
            if (latestRecord?.sendattempt === 3 && latestRecord?.sendexpiry > new Date()) {
                response.return = false;
                response.message = 'Your otp attempt is over. Please try after sometimes.';
                // return response;
                return res.status(400).json({ success: response?.return, message: response?.message });
            }
            if (latestRecord.sendattempt < 3) {
                update.sendattempt = latestRecord.sendattempt + 1;
            } else {
                update.sendattempt = 1;
            }
            update.sendexpiry = new Date(currentDate.getTime() + 4 * 60 * 60 * 1000);
        }
        // const OTP = Math.floor(1000 + Math.random() * 9000);
        const OTP = Math.floor(1000 + Math.random() * 9000);

        await db('otpmanages').where('mobile', mobile).where('country_code', countryCode).del();
        await db('otpmanages').insert({
            'mobile': mobile, country_code: countryCode, otp: '1234', sendattempt: update.sendattempt || 1,
            sendexpiry: update.sendexpiry || new Date(new Date().getTime() + 4 * 60 * 60 * 1000)
        })
        response.return = true;
        response.message = 'OTP Send successful.';
        // });
        return res.status(200).json({ success: response?.return, message: response?.message });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getReviewList(req, res) {
    try {
        const { panditId } = req.query;
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 100;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;

        if (!panditId) return res.status(400).json({ success: false, message: 'Please enter pandit.' });
        const user = await db('reviews as r')
            .leftJoin('users as u', 'u.id', 'r.user_id')
            .select(
                "r.id",
                "r.message",
                "r.rating",
                "r.replay",
                "r.created_at",
                "u.name",
                "u.profile",
            )
            .where('r.pandit_id', panditId).limit(limit)
            .offset(offset);

        const [{ count }] = await db('reviews')
            .count('* as count').where('pandit_id', panditId);
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: user
        }

        return res.status(200).json({ success: true, data: response, message: 'Review get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getPandits, onboard, signup, verifyOtp, reSendOtp, getPanditDetail, getReviewList };
