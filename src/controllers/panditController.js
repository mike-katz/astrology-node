const db = require('../db');
const { decrypt, encrypt } = require('../utils/crypto');
const { decodeJWT } = require('../utils/decodeJWT');
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
        const { mobile, country_code } = req.body;
        if (!mobile || !country_code) return res.status(400).json({ success: false, message: 'Mobile number required.' });
        const pandit = await db('pandits').where('mobile', mobile).first();
        if (pandit) return res.status(400).json({ success: false, message: 'Your mobile number already registered.' });

        const user = await db('otpmanages').where(function () {
            this.where('mobile', mobile);
        }).first();

        if (!user) {
            await db('otpmanages').insert({ mobile, country_code, otp: '1234' });
        }
        return res.status(200).json({ success: true, message: 'Otp Send Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function verifyOtp(req, res) {
    try {
        const { mobile, country_code, otp } = req.body;
        if (!mobile || !country_code || !otp) return res.status(400).json({ success: false, message: 'Mobile number and otp required.' });

        const latestRecord = await db('otpmanages').where('mobile', mobile).first();
        console.log("latestRecord", latestRecord);
        if (!latestRecord) return res.status(400).json({ success: false, message: 'Wrong Otp' });

        const currentDate = new Date();
        if (latestRecord.attempt === 3 && latestRecord.expiry > new Date()) {
            const response = {}
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
        if (otp != latestRecord?.otp) {
            update.expiry = new Date(currentDate.getTime() + 4 * 60 * 60 * 1000);
            await db('otpmanages')
                .where('id', latestRecord?.id)
                .update(update);
            return res.status(400).json({ success: false, data: null, message: 'Wrong otp' });
        }
        update.attempt = 0;
        update.expiry = null;

        await db('otpmanages')
            .where('id', latestRecord?.id)
            .update(update);

        let user = await db('onboardings').where('mobile', mobile).first();
        if (!user) {
            user = await db('onboardings').insert({ mobile, country_code, step: 0, status: "pending" }).returning(['id', 'mobile', 'step']);
        }
        const token = jwt.sign({ userId: user.id, mobile: user.mobile, country_code: user.country_code }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
        // hide password
        const encryptToken = encrypt(token);

        const { name, display_name, gender, profile, email, city, country, experience, primary_expertise, secondary_expertise, other_working, daily_horoscope,
            languages, consaltance_language, available_for, offer_live_session, live_start_time, live_end_time, dedicated_time, response_time,
            chat_rate, call_rate, is_first_chat_free, training_type, guru_name, certificate,
            id_type, id_number, about, achievement_url, address, selfie,
            terms, no_false, consent_profile
        } = user
        const response = {
            "step1": {
                name, profile, display_name, gender, country_code, email, city, country, experience,
                primary_expertise: primary_expertise ? JSON.parse(primary_expertise) : [],
                secondary_expertise, other_working: other_working ? JSON.parse(other_working) : [], daily_horoscope
            },
            "step2": {
                languages, consaltance_language, available_for, offer_live_session, live_start_time, live_end_time, dedicated_time, response_time
            },
            "step3": {
                chat_rate, call_rate, is_first_chat_free, training_type, guru_name, certificate
            },
            "step4": {
                id_type, id_number, about, achievement_url, address, selfie
            },
            "step5": {
                terms, no_false, consent_profile
            }
        }

        return res.status(200).json({ success: true, data: { token: encryptToken, step: user?.step, profile_data: response }, message: 'Otp Verify Successfully' });
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
        const { name, display_name, country_code, mobile, email, city, country, gender, experience, primary_expertise, secondary_expertise, other_working, daily_horoscope, step = 1,
            languages, consaltance_language, available_for, offer_live_session, live_start_time, live_end_time, dedicated_time, response_time,
            chat_rate, call_rate, is_first_chat_free, training_type, guru_name,
            id_type, id_number, about, achievement_url,
            terms, no_false, consent_profile, token
        } = req.body;
        if (!step || !token) return res.status(400).json({ success: false, message: 'Missing params.' });

        const tokenData = decodeJWT(`Bearer ${token}`)
        if (!tokenData?.success) return res.status(400).json({ success: false, message: 'Missing params.' });
        const skill = ["signature_reading", "vedic", "tarot", "kp", "numerology", "lal_kitab", "psychic", "palmistry", "cartomancy", "prashana", "loshu_grid", "nadi", "face_reading", "horary", "life_coach", "western", "gemology", "vastu"]

        const language = ["english", "hindi", "tamil", "panjabi", "marathi", "gujarati", "bangali", "french", "odia", "telugu", "kannada", "malayalam", "sanskrit", "assamese", "german", "spanish", "marwari", "manipuri", "urdu", "sindhi", "kashmiri", "bodo", "nepali", "konkani", "maithili", "arabic", "bhojpuri", "dutch", "rajasthanii"]
        const { files } = req
        if (step == 1) {
            if (!name || !display_name || !email || !city || !country || !gender || !primary_expertise || !experience) return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        if (step == 2) {
            if (!languages || !consaltance_language || !available_for || !live_start_time || !live_end_time || !response_time) return res.status(400).json({ success: false, message: 'Missing params.' });
            const selected = languages.split(",").map(l => l.trim());  // ["english", "hindi"]
            const isValidLanguage = selected.every(l => language.includes(l));
            if (!isValidLanguage) return res.status(400).json({ success: false, message: 'enter valid languages.' });

            const selecteds = consaltance_language.split(",").map(l => l.trim());  // ["english", "hindi"]
            const isValidLanguage_consalt = selecteds.every(l => language.includes(l));
            if (!isValidLanguage_consalt) return res.status(400).json({ success: false, message: 'enter valid Consultation languages.' });
        }
        if (step == 3) {
            if (!chat_rate || !call_rate || !training_type || !guru_name || files?.certificate?.length == 0) return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        if (step == 4) {
            if (!id_type || !id_number || files?.certificate?.length == 0) return res.status(400).json({ success: false, message: 'Missing params.' });
        }

        // const selectedskill = skills.split(",").map(l => l.trim());  // ["english", "hindi"]

        // const isValidSkill = selectedskill.every(l => skill.includes(l));


        // if (!isValidSkill) return res.status(400).json({ success: false, message: 'enter valid skills.' });


        const user = await db('onboardings').where({ "mobile": tokenData?.data?.mobile, country_code: tokenData?.data?.country_code }).first();
        if (!user) return res.status(400).json({ message: 'Wrong mobile number.' });

        // profile_image
        const ins = {}
        if (gender) {
            ins.gender = gender
        }
        if (consent_profile != undefined) {
            ins.consent_profile = consent_profile
        }
        if (no_false != undefined) {
            ins.no_false = no_false
        }
        if (terms != undefined) {
            ins.terms = terms
        }
        if (achievement_url) {
            ins.achievement_url = achievement_url
        }
        if (about) {
            ins.about = about
        }
        if (id_number) {
            ins.id_number = id_number
        }
        if (id_type) {
            ins.id_type = id_type
        }
        if (guru_name) {
            ins.guru_name = guru_name
        }
        if (training_type) {
            ins.training_type = training_type
        }
        if (is_first_chat_free != undefined) {
            ins.is_first_chat_free = is_first_chat_free
        }
        if (call_rate) {
            ins.call_rate = call_rate
        }
        if (chat_rate) {
            ins.chat_rate = chat_rate
        }
        if (dedicated_time) {
            ins.dedicated_time = dedicated_time
        }
        if (live_end_time) {
            ins.live_end_time = live_end_time
        }
        if (live_start_time) {
            ins.live_start_time = live_start_time
        }
        if (offer_live_session != undefined) {
            ins.offer_live_session = offer_live_session
        }
        if (available_for) {
            ins.available_for = available_for
        }
        if (consaltance_language) {
            ins.consaltance_language = consaltance_language
        }
        if (languages) {
            ins.languages = languages
        }
        if (step) {
            ins.step = step
        }
        if (daily_horoscope != undefined) {
            ins.daily_horoscope = daily_horoscope
        }
        if (other_working) {
            ins.other_working = other_working
        }
        if (secondary_expertise) {
            ins.secondary_expertise = secondary_expertise
        }
        if (primary_expertise) {
            ins.primary_expertise = primary_expertise
        }
        if (experience) {
            ins.experience = experience
        }
        if (country) {
            ins.country = country
        }
        if (city) {
            ins.city = city
        }
        if (email) {
            ins.email = email
        }
        if (display_name) {
            ins.display_name = display_name
        }
        if (name) {
            ins.name = name
        }
        // if (phone_type) {
        //     const selected = phone_type.split(",").map(l => l.trim());
        //     ins.phone_type = phone_type ? JSON.stringify(selected) : {}
        // }
        // if (Array.isArray(selected) && selected?.length > 0) {
        //     ins.language = selected ? JSON.stringify(selected) : {}
        // }
        // if (Array.isArray(selectedskill) && selectedskill?.length > 0) {
        //     ins.skill = selectedskill ? JSON.stringify(selectedskill) : {}
        // }

        if (files?.profile?.length > 0) {
            const image = await uploadImageTos3('profile', files?.profile[0], 'pandit');
            ins.profile = image.data.Location;
        }
        if (files?.selfie?.length > 0) {
            const image = await uploadImageTos3('selfie', files?.selfie[0], 'document');
            ins.selfie = image.data.Location;
        }

        if (files?.achievement?.length > 0) {
            const image = await uploadImageTos3('achievement', files?.achievement[0], 'document');
            ins.achievement_url = image.data.Location;
        }

        if (files?.certificate?.length > 0) {
            const certificates = await Promise.all(
                files.certificate.map(file =>
                    uploadImageTos3('certificate', file, 'document')
                        .then(res => res.data.Location)
                )
            );
            ins.certificate = JSON.stringify(certificates);
        }

        if (files?.address?.length > 0) {
            const addresss = await Promise.all(
                files.address.map(file =>
                    uploadImageTos3('address', file, 'document')
                        .then(res => res.data.Location)
                )
            );
            ins.address = JSON.stringify(addresss);
        }

        console.log("ins", ins);
        await db('onboardings').where({ id: user?.id }).update(ins);

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
