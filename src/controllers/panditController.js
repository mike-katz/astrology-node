const db = require('../db');
const { decrypt, encrypt } = require('../utils/crypto');
const { decodeJWT } = require('../utils/decodeJWT');
require('dotenv').config();
const { uploadImageToAzure, deleteFileFromAzure } = require('./azureUploader');
const jwt = require('jsonwebtoken');
const { isValidMobile } = require('../utils/decodeJWT');
const axios = require('axios');
const sendMail = require('../utils/sendMail');

async function getPandits(req, res) {
    try {
        // console.log("req.query", req.query);
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;
        const { type = "chat", search, sort_by, skill, language, gender, country, offer, top_astrologers, secondary_expertise } = req.query
        const filter = { "p.status": "active" };
        let sort
        let orderBy
        let sorting = []
        if (sort_by) {
            if (sort_by == 'popularity') {
                sort = 'tag'
                orderBy = 'desc'
            }
            if (sort_by == 'experience_high_to_low') {
                sort = 'experience'
                orderBy = 'desc'
            }

            if (sort_by == 'experience_low_to_high') {
                sort = 'experience'
                orderBy = 'asc'
            }
            if (sort_by == 'orders_low_to_high') {
                sort = 'total_orders'
                orderBy = 'asc'
            }
            if (sort_by == 'orders_high_to_low') {
                sort = 'total_orders'
                orderBy = 'desc'
            }
            if (sort_by == 'price_low_to_high') {
                sort = 'final_chat_call_rate'
                orderBy = 'asc'
            }
            if (sort_by == 'price_high_to_low') {
                sort = 'final_chat_call_rate'
                orderBy = 'desc'
            }

            sorting.push({
                column: sort, order: orderBy
            })
            if (sort_by == 'rating_high_to_low') {
                // Clear the previous sorting and use rating ratio instead
                sorting = []
            }
            if (sort_by == 'rating_low_to_high') {
                // Clear the previous sorting and use rating ratio instead
                sorting = []
            }
        }

        if (Array.isArray(sorting)) {
            // Filter out entries where column or order is undefined/null
            sorting = sorting.filter(item => {
                return item && item.column !== undefined && item.order !== undefined && item.column !== null && item.order !== null;
            });
        }

        // console.log("sort_by", sorting);
        let query = db('pandits as p')
            //.distinctOn('p.id')
            .select(
                'p.display_name as name',
                'p.id',
                'p.knowledge',
                'p.languages',
                'p.experience',
                'p.profile',
                'p.available_for',
                'p.total_chat_minutes',
                'p.total_call_minutes',
                'p.primary_expertise',
                'p.secondary_expertise',
                'p.discounted_chat_call_rate',
                'p.final_chat_call_rate',
                'p.waiting_time',
                'p.online',
                'p.rating_1',
                'p.rating_2',
                'p.rating_3',
                'p.rating_5',
                'p.rating_4',
                'p.total_orders',
                'p.tag',
                'p.chat_call_rate',
            ).where(filter)
            .where(db.liveFilter('p.deleted_at'))
            .andWhere(function () {
                if (type === 'call') {
                    this.where('p.call', true);
                }
                if (type === 'chat') {
                    this.where('p.chat', true);
                }
                // ✅ OR condition
                // this.orWhere('p.unlimited_free_calls_chats', true);
            })
            .limit(limit)
            .offset(offset);
        let countQuery = db('pandits as p')
            .count('* as count').where(filter)
            .where(db.liveFilter('p.deleted_at'))
            .andWhere(function () {
                if (type === 'call') {
                    this.where('p.call', true);
                }
                if (type === 'chat') {
                    this.where('p.chat', true);
                }
            });
        if (search && search.trim()) {
            query.andWhere('p.display_name', 'ilike', `%${search.trim()}%`);
            countQuery.andWhere('p.display_name', 'ilike', `%${search.trim()}%`);
        }

        if (secondary_expertise && secondary_expertise != 'all') {
            query.andWhere('p.secondary_expertise', 'ILIKE', `%${secondary_expertise.trim()}%`);
            countQuery.andWhere('p.secondary_expertise', 'ILIKE', `%${secondary_expertise.trim()}%`);
        }

        if (Array.isArray(skill) && skill.length) {
            // query.andWhere(builder => {
            //     skill.forEach((s, index) => {
            //         const condition = ['ilike', `%${s.trim()}%`];
            //         index === 0
            //             ? builder.where('p.primary_expertise', ...condition)
            //             : builder.orWhere('p.primary_expertise', ...condition);
            //     });
            // });

            // countQuery.andWhere(builder => {
            //     skill.forEach((s, index) => {
            //         const condition = ['ilike', `%${s.trim()}%`];
            //         index === 0
            //             ? builder.where('p.primary_expertise', ...condition)
            //             : builder.orWhere('p.primary_expertise', ...condition);
            //     });
            // });

            const skills = skill
                .map(s => s?.trim())
                .filter(Boolean)
                .map(s => `%${s}%`);

            query.andWhereRaw(
                `p.primary_expertise ILIKE ANY (ARRAY[${skills.map(() => '?').join(',')}])`,
                skills
            );

            countQuery.andWhereRaw(
                `p.primary_expertise ILIKE ANY (ARRAY[${skills.map(() => '?').join(',')}])`,
                skills
            );
        }

        if (Array.isArray(language) && language.length) {
            // query.andWhere(builder => {
            //     language.forEach((s, index) => {
            //         const condition = ['ilike', `%${s.trim()}%`];
            //         index === 0
            //             ? builder.where('p.languages', ...condition)
            //             : builder.orWhere('p.languages', ...condition);
            //     });
            // });

            // countQuery.andWhere(builder => {
            //     language.forEach((s, index) => {
            //         const condition = ['ilike', `%${s.trim()}%`];
            //         index === 0
            //             ? builder.where('p.languages', ...condition)
            //             : builder.orWhere('p.languages', ...condition);
            //     });
            // });

            const languages = language
                .map(s => s?.trim())
                .filter(Boolean)
                .map(s => `%${s}%`);

            query.andWhereRaw(
                `p.languages ILIKE ANY (ARRAY[${languages.map(() => '?').join(',')}])`,
                languages
            );

            countQuery.andWhereRaw(
                `p.languages ILIKE ANY (ARRAY[${languages.map(() => '?').join(',')}])`,
                languages
            );
        }

        if (Array.isArray(gender) && gender.length) {
            // console.log("gender.length", gender.length);
            const genders = gender
                .map(g => g?.trim().toLowerCase())
                .filter(Boolean);
            query.whereIn(
                db.raw('LOWER(p.gender)'),
                genders
            );
            countQuery.whereIn(
                db.raw('LOWER(p.gender)'),
                genders
            );
        }

        if (Array.isArray(top_astrologers) && top_astrologers.length && !top_astrologers.includes("All")) {

            const genders = top_astrologers
                .map(g => g?.trim().toLowerCase())
                .filter(Boolean);

            // console.log("genders", genders);
            query.whereIn(
                db.raw('LOWER(p.tag)'),
                genders
            );
            countQuery.whereIn(
                db.raw('LOWER(p.tag)'),
                genders
            );
        }

        if (Array.isArray(country) && country.length == 1) {
            // console.log("country", country[0]);
            if (country[0] == 'India') {
                query.andWhere('p.country', "India");
                countQuery.andWhere('p.country', "India");
            } else {
                query.andWhereNot('p.country', "India");
                countQuery.andWhereNot('p.country', "India");
            }
        }

        // if (offer && offer.trim()) {
        //     query.andWhere('p.tag', 'ilike', `%${offer.trim()}%`);
        //     countQuery.andWhere('p.tag', 'ilike', `%${offer.trim()}%`);
        // }

        if (sort_by == 'rating_high_to_low') {
            // Sort by rating ratio: (rating_5 + rating_4) / total_ratings
            // Higher ratio means more high ratings, so sort desc
            query.orderByRaw(`
                CASE 
                    WHEN (COALESCE(p.rating_1, 0) + COALESCE(p.rating_2, 0) + COALESCE(p.rating_3, 0) + COALESCE(p.rating_4, 0) + COALESCE(p.rating_5, 0)) > 0 
                    THEN (COALESCE(p.rating_5, 0) + COALESCE(p.rating_4, 0))::float / 
                         (COALESCE(p.rating_1, 0) + COALESCE(p.rating_2, 0) + COALESCE(p.rating_3, 0) + COALESCE(p.rating_4, 0) + COALESCE(p.rating_5, 0))::float
                    ELSE 0 
                END DESC
            `)
        } else if (sort_by == 'rating_low_to_high') {
            // Sort by rating ratio ascending (lower ratio first)
            query.orderByRaw(`
                CASE 
                    WHEN (COALESCE(p.rating_1, 0) + COALESCE(p.rating_2, 0) + COALESCE(p.rating_3, 0) + COALESCE(p.rating_4, 0) + COALESCE(p.rating_5, 0)) > 0 
                    THEN (COALESCE(p.rating_5, 0) + COALESCE(p.rating_4, 0))::float / 
                         (COALESCE(p.rating_1, 0) + COALESCE(p.rating_2, 0) + COALESCE(p.rating_3, 0) + COALESCE(p.rating_4, 0) + COALESCE(p.rating_5, 0))::float
                    ELSE 0 
                END ASC
            `)
        } else if (sorting?.length > 0) {
            query.orderBy(sorting)
        }

        const user = await query;
        const [{ count }] = await countQuery
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        user.map(item => {
            item.govt_id = item?.govt_id ? JSON.parse(item?.govt_id) : [];
            item.available_for = item?.available_for ? JSON.parse(item?.available_for) : [];
            item.consaltance_language = item?.consaltance_language ? JSON.parse(item?.consaltance_language) : [];
            item.languages = item?.languages ? JSON.parse(item?.languages) : [];
            item.address = item?.address ? JSON.parse(item?.address) : [];
            item.other_working = item?.other_working ? JSON.parse(item?.other_working) : [];
            item.primary_expertise = item?.primary_expertise ? JSON.parse(item?.primary_expertise) : [];
            item.secondary_expertise = item?.secondary_expertise ? JSON.parse(item?.secondary_expertise) : [];
            item.certificate = item?.certificate ? JSON.parse(item?.certificate) : [];
        })
        const response = {
            page,
            limit,
            total,
            totalPages,
            results: user
        }
        return res.status(200).json({ success: true, data: response, message: 'List success' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getPanditDetail(req, res) {
    const { id } = req.query;
    // console.log("authHeader", req.headers);
    // console.log("getPanditDetail id", id);
    const user = await db('pandits').where('id', id).first();
    if (!user) return res.status(400).json({ success: false, message: 'pandit not available.' });
    // const review = await db('reviews as r')
    //     .where('r.pandit_id', id)
    //     .orderBy('r.created_at', 'desc')
    //     .limit(3);

    const gallery = await db('panditgallery').where({ pandit_id: id }).orderBy('order', 'asc');
    const response = {
        id: user?.id,
        name: user?.display_name,
        knowledge: user?.knowledge,
        languages: user?.languages ? JSON.parse(user?.languages) : [],
        primary_expertise: user?.primary_expertise ? JSON.parse(user?.primary_expertise) : [],
        experience: user?.experience,
        profile: user?.profile,
        waiting_time: user?.waiting_time,
        online: user?.online,
        chat_call_rate: user?.chat_call_rate,
        available_for: user?.available_for ? JSON.parse(user?.available_for) : [],
        discounted_chat_call_rate: user?.discounted_chat_call_rate,
        final_chat_call_rate: user?.final_chat_call_rate,
        about: user?.about,
        chat: user?.chat,
        call: user?.call,
        total_chat_minutes: user?.total_chat_minutes,
        total_call_minutes: user?.total_call_minutes,
        rating_1: user?.rating_1,
        rating_2: user?.rating_2,
        rating_3: user?.rating_3,
        rating_4: user?.rating_4,
        rating_5: user?.rating_5,
        total_orders: user?.total_orders,
        tag: user?.tag,
        isverified: user?.isverified,
        audio_intro: user?.audio_intro,
        video_intro: user?.video_intro,
        // reviews: review,
        isFollow: false,
        gallery
    }
    const authHeader = req.headers.authorization;
    // console.log("authHeader", authHeader);
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const decryptToken = decrypt(token);
        const verified = jwt.verify(decryptToken, process.env.JWT_SECRET);
        // console.log("verified", verified);
        if (verified?.userId) {
            const user = await db('follows').where({ 'pandit_id': id, 'user_id': verified?.userId }).first();
            // console.log("user", user);
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
        const isValid = isValidMobile(mobile);
        if (!isValid) return res.status(400).json({ success: false, message: 'Enter valid mobile number.' });
        const pandit = await db.live('pandits').where({ mobile }).first();
        if (pandit) return res.status(400).json({ success: false, message: 'Your mobile number already registered.' });

        const user = await db('otpmanages').where(function () {
            this.where('mobile', mobile);
        }).first();

        const onboardings = await db.live('onboardings').where({ mobile, country_code }).first();
        if (onboardings && onboardings?.status == 'blocked') {
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
        if (!user) {
            await db('otpmanages').insert({ mobile, country_code, otp: otpResponse?.otpId });
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
        const isValid = isValidMobile(mobile);
        if (!isValid) return res.status(400).json({ success: false, message: 'Enter valid mobile number.' });
        const latestRecord = await db('otpmanages').where('mobile', mobile).first();
        // console.log("latestRecord", latestRecord);
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

        const url = `http://pro.trinityservices.co.in/validateOtpApi.jsp?mobileno=${mobile}&otp=${otp}`;
        let otpResponse;
        try {
            otpResponse = await axios.get(url);
            otpResponse = otpResponse.data
            if (otpResponse?.result != "success") {
                update.expiry = new Date(currentDate.getTime() + 4 * 60 * 60 * 1000);
                await db('otpmanages')
                    .where('id', latestRecord?.id)
                    .update(update);
                return res.status(400).json({ success: false, data: null, message: 'Wrong otp' });
            }
        } catch (error) {
            console.error('Acquire API failed:', error.message);
            otpResponse = null;
        }


        update.attempt = 0;
        update.expiry = null;

        await db('otpmanages')
            .where('id', latestRecord?.id)
            .update(update);

        let user = await db.live('onboardings').where({ mobile, country_code }).first();
        if (!user) {
            [user] = await db('onboardings').insert({ mobile, country_code, step: 0, status: "number" }).returning(['id', 'mobile', 'country_code', 'step']);
        }
        // console.log("user", user);
        const token = jwt.sign({ userId: user.id, mobile: user.mobile, country_code: user.country_code }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1h' });
        // hide password
        const encryptToken = encrypt(token);

        const { name, gender, profile, email, dob, city, country, experience, primary_expertise, secondary_expertise, other_working, other_working_text,
            languages, available_for,
            chat_call_rate, training_type, guru_name, certificate,
            govt_id, about, achievement_url, address, selfie, achievement_file,
            terms, no_false, consent_profile, step = 0, application_id, remark, reject_proof, status
        } = user
        if (status == 'blocked') {
            return res.status(400).json({ success: false, message: 'Your account is blocked.' });
        }
        const response = {
            "application_id": application_id,
            "remark": remark,
            "reject_proof": reject_proof,
            "status": status,
            "step1": {
                name: name || "", profile: profile || "",
                // display_name: display_name || "",
                gender: gender || "",
                dob: dob || "",
                country_code: country_code || "", email: email || "", city: city || "", country: country || "", experience: experience || "",
                primary_expertise: primary_expertise ? JSON.parse(primary_expertise) : [],
                secondary_expertise: secondary_expertise ? JSON.parse(secondary_expertise) : [],
                other_working_text: other_working_text || "",
                other_working: other_working ? JSON.parse(other_working) : []
            },
            "step2": {
                languages: languages ? JSON.parse(languages) : [],
                available_for: available_for ? JSON.parse(available_for) : [],
                chat_call_rate: chat_call_rate || "",
                training_type: training_type || "",
                guru_name: guru_name || "",
                certificate: certificate ? JSON.parse(certificate) : [],
                // response_time: response_time || ""
            },
            "step3": {
                govt_id: govt_id ? JSON.parse(govt_id) : [],
                about: about || "", achievement_url: achievement_url || "",
                address: address ? JSON.parse(address) : [],
                selfie: selfie || "", achievement_file: achievement_file || ""
            },
            "step4": {
                terms: terms || "", no_false: no_false || "", consent_profile: consent_profile || ""
            }
        }

        return res.status(200).json({ success: true, data: { token: encryptToken, step, profile_data: response }, message: 'Otp Verify Successfully' });
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

async function basicOnboard(req, res) {
    try {
        const { name, dob, email, gender, primary_expertise, languages, country_code, mobile, country, city, experience, secondary_expertise } = req.body
        const { files } = req
        if (!name || !dob || !email || !gender || !primary_expertise || !languages || !country_code || !mobile || !country || !city || !experience || !secondary_expertise) return res.status(400).json({ message: 'Missing params.' });
        const user = await db.live('onboardings').where({ mobile, country_code }).first();
        if (!user) return res.status(400).json({ message: 'Wrong mobile number.' });
        const orderId = Math.floor(1000000000000000 + Math.random() * 9000000000000000).toString();
        const ins = {
            name, dob, email, gender, application_id: orderId, step: 0, country, city, experience, status: "inquiry", step: 1
        }

        if (secondary_expertise) {
            ins.secondary_expertise = JSON.stringify(secondary_expertise)
        }
        if (!is18OrAbove(dob)) return res.status(400).json({ success: false, message: 'Enter DOB above 18+ year.' });

        if (files?.profile?.length > 0) {
            const image = await uploadImageToAzure('profile', files?.profile[0], 'pandit');
            ins.profile = image.data.Location;
        }
        if (languages) {
            ins.languages = JSON.stringify(languages)
        }
        if (primary_expertise) {
            ins.primary_expertise = JSON.stringify(primary_expertise)
        }
        const [result] = await db('onboardings').where({ id: user?.id }).update(ins).returning("*")

        // Fetch settings for app name and support email
        const settings = await db('settings').first();
        const appName = settings?.app_name || "AstroGuruji";
        const supportEmail = settings?.support_email || process.env.SUPPORT_EMAIL || "support@astroguruji.com";

        // Send welcome email with dynamic values (queued - non-blocking)
        if (email) {
            // Email is added to queue, doesn't block the request
            // Worker will automatically process all jobs from database table
            sendMail(
                email,
                "Welcome to AstroGuruji - Registration Successful",
                "welcome",
                {
                    panditName: name || "User",
                    applicationNo: orderId,
                    appName: appName,
                    supportEmail: supportEmail
                }
            ).catch(emailError => {
                console.error("❌ Error queuing welcome email:", emailError);
                console.error("Error details:", emailError.message, emailError.stack);
                // Don't fail the request if email queue fails
            });
        }
        const response = {
            "step": 1,
            "application_id": orderId,
            "remark": user?.remark || "",
            "reject_proof": user?.reject_proof || "",
            "status": user?.status || "",
            "step1": {
                name: name || "",
                profile: ins?.profile || "",
                gender: gender || "",
                dob: dob || "",
                country_code: country_code || "",
                email: email || "",
                city: city || "",
                country: country || "",
                experience: experience || "",
                primary_expertise: primary_expertise || [],
                secondary_expertise: secondary_expertise || [],
                other_working_text: "",
                other_working: []
            },
            "step2": {
                languages: languages || [],
                available_for: [],
                chat_call_rate: "",
                training_type: "",
                guru_name: "",
                certificate: [],
                // response_time: response_time || ""
            },
            "step3": {
                govt_id: [],
                about: "", achievement_url: "",
                address: [],
                selfie: "", achievement_file: ""
            },
            "step4": {
                terms: "", no_false: "", consent_profile: ""
            }
        }
        return res.status(200).json({ success: true, data: response, message: 'Basic onboard Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function onboard(req, res) {
    try {
        const { name, dob, country_code, mobile, email, city, country, gender, experience, primary_expertise, secondary_expertise, other_working, other_working_text, step = 1,
            languages, available_for,
            chat_call_rate, training_type, guru_name, certificate,
            govt_id, about, achievement_url, address, achievement_file,
            terms, no_false, consent_profile, token
        } = req.body;
        if (!step || !token) return res.status(400).json({ success: false, message: 'Missing params.' });

        const tokenData = decodeJWT(`Bearer ${token}`)
        if (!tokenData?.success) return res.status(400).json({ success: false, message: 'Missing params.' });
        const skill = ["signature_reading", "vedic", "tarot", "kp", "numerology", "lal_kitab", "psychic", "palmistry", "cartomancy", "prashana", "loshu_grid", "nadi", "face_reading", "horary", "life_coach", "western", "gemology", "vastu"]

        const language = ["english", "hindi", "tamil", "panjabi", "marathi", "gujarati", "bangali", "french", "odia", "telugu", "kannada", "malayalam", "sanskrit", "assamese", "german", "spanish", "marwari", "manipuri", "urdu", "sindhi", "kashmiri", "bodo", "nepali", "konkani", "maithili", "arabic", "bhojpuri", "dutch", "rajasthanii"]
        const { files } = req
        if (step == 1) {
            if (!name || !dob || !email || !city || !country || !gender || !primary_expertise || !experience) return res.status(400).json({ success: false, message: 'Missing params.' });
            // if (other_working == 'other' && !other_working_text) return res.status(400).json({ success: false, message: 'Missing params.' });
            if (!is18OrAbove(dob)) return res.status(400).json({ success: false, message: 'Enter DOB above 18+ year.' });
        }
        if (step == 2) {
            if (!languages || !available_for || !chat_call_rate || !training_type || !guru_name) return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        if (step == 3) {
            if (!govt_id) return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        if (step == 4) {
            if (!terms || !no_false || !consent_profile) return res.status(400).json({ success: false, message: 'Missing params.' });
        }

        // console.log("tokenData", JSON.stringify(tokenData));
        const user = await db.live('onboardings').where({ "mobile": tokenData?.data?.mobile, country_code: tokenData?.data?.country_code }).first();
        if (!user) return res.status(400).json({ message: 'Wrong mobile number.' });

        // if (display_name) {
        //     if (display_name.length > 15) return res.status(400).json({ success: false, message: 'Max 15 character accept.' });
        //     const onboard = await db('onboardings').where({ "display_name": display_name, deleted_at: null }).whereNot({ id: user?.id }).first();
        //     const pandit = await db('pandits').where({ "display_name": display_name, deleted_at: null }).first();
        //     if (onboard || pandit) return res.status(400).json({ success: false, message: 'Display name already exist.' });
        // }

        // const selectedskill = skills.split(",").map(l => l.trim());  // ["english", "hindi"]

        // const isValidSkill = selectedskill.every(l => skill.includes(l));


        // if (!isValidSkill) return res.status(400).json({ success: false, message: 'enter valid skills.' });


        // profile_image
        const ins = {}

        const oldStatus = await db('onboardlogs').where({ "onboard_id": Number(user?.id) }).orderBy('id', 'desc').first();
        if (oldStatus) {
            ins.status = oldStatus?.old_status
            ins.reject_proof = ""
            ins.remark = ""
        }
        if (gender) {
            ins.gender = gender
        }
        if (other_working_text) {
            ins.other_working_text = other_working_text
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
            ins.achievement_file = ""
        }
        if (about) {
            ins.about = about
        }
        if (dob) {
            ins.dob = dob
        }
        // if (id_number) {
        //     ins.id_number = id_number
        // }
        if (govt_id) {
            ins.govt_id = JSON.stringify(govt_id)
        }
        if (guru_name) {
            ins.guru_name = guru_name
        }
        if (training_type) {
            ins.training_type = training_type
        }
        // if (is_first_chat_free != undefined) {
        //     ins.is_first_chat_free = is_first_chat_free
        // }
        if (chat_call_rate) {
            const setting = await db('settings').first();
            if (setting?.chat_call_min_base_rate > chat_call_rate) {
                return res.status(400).json({ success: false, message: `Price minimum ${setting?.chat_call_min_base_rate} required.` });
            }
            if (setting?.chat_call_max_base_rate && chat_call_rate > setting?.chat_call_max_base_rate) {
                return sendError(res, `Rate maximum ${setting?.chat_call_max_base_rate} allowed.`);
            }
            ins.chat_call_rate = chat_call_rate
        }
        // if (dedicated_time) {
        //     ins.dedicated_time = dedicated_time
        // }
        // if (live_end_time) {
        //     ins.live_end_time = live_end_time
        // }
        // if (live_start_time) {
        //     ins.live_start_time = live_start_time
        // }
        // if (offer_live_session != undefined) {
        //     ins.offer_live_session = offer_live_session
        // }
        if (available_for) {
            ins.available_for = JSON.stringify(available_for)
        }
        // if (consaltance_language) {
        //     ins.consaltance_language = JSON.stringify(consaltance_language)
        // }
        if (languages) {
            ins.languages = JSON.stringify(languages)
        }
        if (address) {
            ins.address = JSON.stringify(address)
        }
        if (step > user?.step) {
            ins.step = step
        }
        // if (daily_horoscope != undefined) {
        //     ins.daily_horoscope = daily_horoscope
        // }
        if (other_working) {
            ins.other_working = JSON.stringify(other_working)
        }
        if (secondary_expertise) {
            ins.secondary_expertise = JSON.stringify(secondary_expertise)
        }
        if (primary_expertise) {
            ins.primary_expertise = JSON.stringify(primary_expertise)
        }
        if (certificate) {
            ins.certificate = JSON.stringify(certificate)
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
        // if (display_name) {
        //     ins.display_name = display_name
        // }
        // if (response_time) {
        //     ins.response_time = response_time
        // }
        if (achievement_file) {
            ins.achievement_file = achievement_file
            ins.achievement_url = ""
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
            const image = await uploadImageToAzure('profile', files?.profile[0], 'pandit');
            ins.profile = image.data.Location;
        }
        if (files?.selfie?.length > 0) {
            const image = await uploadImageToAzure('selfie', files?.selfie[0], 'document');
            ins.selfie = image.data.Location;
        }

        // if (files?.achievement?.length > 0) {
        //     const image = await uploadImageToAzure('achievement', files?.achievement[0], 'document');
        //     ins.achievement_file = image.data.Location;
        // }

        // if (files?.certificate?.length > 0) {
        //     const certificates = await Promise.all(
        //         files.certificate.map(file =>
        //             uploadImageToAzure('certificate', file, 'document')
        //                 .then(res => res.data.Location)
        //         )
        //     );
        //     ins.certificate = JSON.stringify(certificates);
        // }

        // if (files?.address?.length > 0) {
        //     const addresss = await Promise.all(
        //         files.address.map(file =>
        //             uploadImageToAzure('address', file, 'document')
        //                 .then(res => res.data.Location)
        //         )
        //     );
        //     console.log("addresss", addresss);
        //     ins.address = JSON.stringify(addresss);
        // }

        // console.log("ins", ins);
        await db('onboardings').where({ id: user?.id }).update(ins);

        return res.status(200).json({
            success: true, message: `step${step} update Successfully`
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function reSendOtp(req, res) {
    try {
        const { mobile, country_code } = req.body;
        if (!mobile || !country_code) return res.status(400).json({ success: false, message: 'Mobile number required.' });
        const isValid = isValidMobile(mobile);
        if (!isValid) return res.status(400).json({ success: false, message: 'Enter valid mobile number.' });
        const latestRecord = await db('otpmanages').where('mobile', mobile).where('country_code', country_code).first();
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

        const url = `http://pro.trinityservices.co.in/generateOtp.jsp?userid=${process.env.OTP_USERNAME}&key=${process.env.OTP_KEY}&mobileno=${mobile}&timetoalive=600&sms=%7Botp%7D%20is%20the%20one%20time%20password%20for%20Astroguruji%20Application.%20AstrotalkGuruji`
        let otpResponse;
        try {
            otpResponse = await axios.get(url);
            otpResponse = otpResponse.data
        } catch (error) {
            console.error('Acquire API failed:', error.message);
            otpResponse = null;
        }

        await db('otpmanages').where('mobile', mobile).where('country_code', country_code).del();
        await db('otpmanages').insert({
            'mobile': mobile, country_code: country_code, otp: otpResponse?.otpId, sendattempt: update.sendattempt || 1,
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
        const pandit = await db('pandits').where({ id: Number(panditId) }).first()

        const user = await db('reviews as r')
            .leftJoin('users as u', 'u.id', 'r.user_id')
            .select(
                "r.id",
                "r.message",
                "r.rating",
                "r.replay",
                "r.created_at",
                "r.hide",
                "u.name",
                "u.avatar",
                "u.profile"
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
            results: user,
            panditDetail: {
                rating_1: pandit?.rating_1,
                rating_2: pandit?.rating_2,
                rating_3: pandit?.rating_3,
                rating_4: pandit?.rating_4,
                rating_5: pandit?.rating_5,
                total_orders: pandit?.total_orders,
            }
        }

        return res.status(200).json({ success: true, data: response, message: 'Review get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

function removeMatchedUrl(data, toFind) {
    return data.map(doc => {
        const updatedDoc = { ...doc };

        Object.keys(updatedDoc).forEach(key => {
            if (Array.isArray(updatedDoc[key])) {
                updatedDoc[key] = updatedDoc[key].filter(url => url !== toFind);
            }
        });

        return updatedDoc;
    });
}


async function uploadImage(req, res) {
    try {
        let { type = 'upload', token, file } = req.body
        const { files } = req
        let url = "";
        const tokenData = decodeJWT(`Bearer ${token}`)
        if (!tokenData?.success) return res.status(400).json({ success: false, message: 'Missing params.' });

        if (type == 'upload') {
            if (files?.file?.length > 0) {
                const image = await uploadImageToAzure('file', files?.file[0], 'upload');
                url = image.data.Location;
            }
        }
        // console.log("type", type);
        if (type == 'delete') {
            if (!file) return res.status(400).json({ success: false, message: 'File URL is required.' });
            const decodedUrl = decodeURIComponent(file);

            // Get onboarding record for the user
            const onboarding = await db.live('onboardings')
                .where({
                    'mobile': tokenData?.data?.mobile,
                    'country_code': tokenData?.data?.country_code
                })
                .first();

            if (!onboarding) {
                return res.status(400).json({ success: false, message: 'Onboarding record not found.' });
            }

            let updated = false;
            const updateData = {};

            // Check and remove from certificate array (stringified array of URLs)
            if (onboarding.certificate) {
                try {
                    const certificateArray = JSON.parse(onboarding.certificate);
                    const result = certificateArray.filter(item => item !== file);
                    if (result?.length == 0) {
                        updateData.certificate = null
                    } else {
                        updateData.certificate = JSON.stringify(result)
                    }
                } catch (e) {
                    console.error('Error parsing certificate:', e);
                }
            }

            // Check and remove from govt_id array (array of objects with URL)
            if (onboarding.govt_id) {
                const govt_id = JSON.parse(onboarding.govt_id);
                const returns = removeMatchedUrl(govt_id, file)
                updateData.govt_id = JSON.stringify(returns);

            }
            // console.log("updateData", updateData);
            // Update database if URL was found and removed
            if (Object.keys(updateData).length > 0) {
                await db('onboardings')
                    .where({ id: onboarding.id })
                    .update(updateData);
            }

            // Delete file from S3
            const dd = await deleteFileFromAzure(decodedUrl);
            // console.log("dd", dd);
        }
        return res.status(200).json({ success: true, data: url, message: `Image ${type} Successfully` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function submitOnboard(req, res) {
    try {
        const { token, terms, no_false, consent_profile } = req.body
        console.log("submitOnboard req.body", req.body);
        const tokenData = decodeJWT(`Bearer ${token}`)
        if (!tokenData?.success) return res.status(400).json({ success: false, message: 'Missing params.' });
        const user = await db.live('onboardings').where({ "mobile": tokenData?.data?.mobile, country_code: tokenData?.data?.country_code }).first();
        if (!user) return res.status(400).json({ message: 'Wrong mobile number.' });

        // Check if user is on step 4
        // if (user?.step >= 3) {
        //     return res.status(400).json({ success: false, message: 'Please complete all onboard steps before submission.' });
        // }

        // Step 1 required fields - parse JSON string for primary_expertise
        let primary_expertise = [];
        try {
            primary_expertise = user?.primary_expertise ? JSON.parse(user.primary_expertise) : [];
        } catch (e) {
            console.error('Error parsing primary_expertise:', e);
        }

        if (!user?.name || !user?.dob || !user?.email || !user?.city || !user?.country || !user?.gender || !primary_expertise || primary_expertise.length === 0 || !user?.experience) {
            return res.status(400).json({ success: false, message: 'Please complete step 1: name, dob, email, city, country, gender, primary_expertise, and experience are required.' });
        }

        // Step 2 required fields - parse JSON strings to check if they're empty
        let languages = [];
        let available_for = [];
        let certificate = [];
        try {
            languages = user?.languages ? JSON.parse(user.languages) : [];
            available_for = user?.available_for ? JSON.parse(user.available_for) : [];
            certificate = user?.certificate ? JSON.parse(user.certificate) : [];
        } catch (e) {
            console.error('Error parsing JSON fields:', e);
        }

        if (!languages || languages.length === 0 || !available_for || available_for.length === 0 || !user?.chat_call_rate || !user?.training_type || !user?.guru_name) {
            return res.status(400).json({ success: false, message: 'Please complete step 2: languages, available_for, chat_call_rate, training_type, guru_name, and certificate are required.' });
        }

        // Step 3 required fields - parse JSON string to check if it's empty
        let govt_id = [];
        try {
            govt_id = user?.govt_id ? JSON.parse(user.govt_id) : [];
        } catch (e) {
            console.error('Error parsing govt_id:', e);
        }

        if (!govt_id || govt_id.length === 0) {
            return res.status(400).json({ success: false, message: 'Please complete step 3: govt_id is required.' });
        }

        // Validate govt_id documents based on document type
        for (const doc of govt_id) {
            const label = doc?.label?.toLowerCase() || '';

            // Aadhaar Card requires both front and back images
            if (label === 'aadhaar card' || label === 'aadhar card' || label === 'aadhar') {
                const front_image = doc?.front_image || [];
                const back_image = doc?.back_image || [];

                if (!Array.isArray(front_image) || front_image.length === 0) {
                    return res.status(400).json({ success: false, message: 'Aadhaar Card front image is required.' });
                }
                if (!Array.isArray(back_image) || back_image.length === 0) {
                    return res.status(400).json({ success: false, message: 'Aadhaar Card back image is required.' });
                }
            }
            // PAN Card requires front image
            else if (label === 'pan card' || label === 'pan') {
                const front_image = doc?.front_image || [];

                if (!Array.isArray(front_image) || front_image.length === 0) {
                    return res.status(400).json({ success: false, message: 'PAN Card front image is required.' });
                }
            }
            // Passport requires front image
            else if (label === 'passport') {
                const front_image = doc?.front_image || [];

                if (!Array.isArray(front_image) || front_image.length === 0) {
                    return res.status(400).json({ success: false, message: 'Passport front image is required.' });
                }
            }
        }

        // Step 4 required fields
        if (!terms || !no_false || !consent_profile) {
            return res.status(400).json({ success: false, message: 'Please complete step 4: terms, no_false, and consent_profile are required.' });
        }

        await db('onboardings').where({ id: user?.id }).update({ status: "inquiry", step: 4, terms: true, no_false: true, consent_profile: true })
        return res.status(200).json({ success: true, data: null, message: `Submit Successfully` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}
module.exports = { getPandits, onboard, signup, verifyOtp, reSendOtp, getPanditDetail, getReviewList, uploadImage, submitOnboard, basicOnboard };
