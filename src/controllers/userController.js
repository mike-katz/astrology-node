const db = require('../db');

require('dotenv').config();
const { uploadImageTos3, deleteFileFroms3 } = require('./uploader');

const { deleteKey } = require('../config/redisClient');

async function makeAvtarString(user, gender) {
    if (!user || !gender) return null;

    const firstChar = user.trim().charAt(0).toUpperCase();

    const zodiacMap = {
        aries: ['A', 'L', 'E', 'I', 'O'],
        taurus: ['B', 'V', 'U', 'W'],
        gemini: ['K', 'C', 'G'],
        cancer: ['D', 'H'],
        leo: ['M', 'T'],
        virgo: ['P', 'N'],
        libra: ['R', 'T'],
        scorpio: ['N', 'Y'],
        sagittarius: ['F', 'D', 'P'],
        capricorn: ['K', 'J'],
        aquarius: ['G', 'S'],
        pisces: ['Z', 'C', 'L']
    };

    let zodiac = 'aries'; // default fallback

    for (const [sign, letters] of Object.entries(zodiacMap)) {
        if (letters.includes(firstChar)) {
            zodiac = sign;
            break;
        }
    }

    const genderMap = {
        male: 'm',
        female: 'f',
        other: 'o'
    };

    const genderKey = genderMap[gender.toLowerCase()] || 'o';

    const random = Math.floor(Math.random() * 3) + 1;
    return `${zodiac}_${genderKey}_${random}`;
}

async function getProfile(req, res) {
    const user = await db('users')
        .where('id', req?.userId)
        .first();
    user.language = user?.language ? JSON.parse(user?.language) : []
    user.my_interest = user?.my_interest ? JSON.parse(user?.my_interest) : []
    if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
    return res.status(200).json({ success: true, data: user, message: 'Profile get Successfully' });
}

async function updateProfile(req, res) {
    try {
        const { name, gender, dob, dot = '12:00:00', birth_place, current_address, city_state_country, pincode, language, astromall_chat, live_event, my_interest, lat, lng } = req.body;

        if (!name) return res.status(400).json({ success: false, message: 'Please enter name.' });
        const user = await db('users')
            .where('id', req?.userId)
            .first();
        if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
        if (language && language?.length > 5) {
            return res.status(400).json({ success: false, message: 'Max 5 language allowed.' });
        }
        if (my_interest && my_interest?.length > 5) {
            return res.status(400).json({ success: false, message: 'Max 5 interest allowed.' });
        }
        const update = {}
        if (name) {
            update.name = name
            update.avatar = await makeAvtarString(name || user?.name, gender || user?.gender)
        }
        if (gender) {
            update.gender = gender
            update.avatar = await makeAvtarString(name || user?.name, gender || user?.gender)
        }
        if (dob) {
            update.dob = dob
        }
        if (dot) {
            update.birth_time = dot
        }
        if (birth_place) {
            update.birth_place = birth_place
        }
        if (current_address) {
            update.current_address = current_address
        }
        if (city_state_country) {
            update.city_state_country = city_state_country
        }
        if (pincode) {
            update.pincode = pincode
        }
        if (lat) {
            update.lat = lat
        }
        if (lng) {
            update.lng = lng
        }
        if (language?.length > 0) {
            update.language = language ? JSON.stringify(language) : {}
        }
        if (my_interest?.length > 0) {
            update.my_interest = my_interest ? JSON.stringify(my_interest) : {}
        }
        if (astromall_chat != undefined) {
            update.astromall_chat = astromall_chat
        }
        if (live_event != undefined) {
            update.live_event = live_event
        }

        await db('users')
            .where('id', user?.id)
            .update(update);

        const isProfileExist = await db('userprofiles')
            .where({ 'user_id': req?.userId, is_first: true }).first();

        delete update.language
        delete update.my_interest
        delete update.pincode
        delete update.city_state_country
        delete update.current_address
        delete update.astromall_chat
        delete update.live_event
        delete update.avatar

        if (isProfileExist) {
            await db('userprofiles')
                .where('id', isProfileExist?.id)
                .update(update);
        } else {
            update.is_first = true;
            update.user_id = req.userId
            await db('userprofiles')
                .insert(update);
        }
        return res.status(200).json({ success: true, message: 'Profile update Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getBalance(req, res) {
    const user = await db('users')
        .where('id', req?.userId)
        .select('balance')
        .first();
    if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
    return res.status(200).json({ success: true, data: user, message: 'Profile get Successfully' });
}

async function updateToken(req, res) {
    const { token, ios_token } = req.body;
    try {
        const order = await db('users').where({ id: req.userId }).first();
        if (!order) return res.status(400).json({ success: false, message: 'User not found.' });
        const update = {}
        if (token != undefined) {
            update.token = token
        }
        if (ios_token != undefined) {
            update.ios_token = ios_token
        }
        await db('users').where({ id: req.userId }).update(update);
        return res.status(200).json({ success: true, data: null, message: 'Update successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function profileUpdate(req, res) {
    try {
        const order = await db('users').where({ id: req.userId }).first();
        if (!order) return res.status(400).json({ success: false, message: 'User not found.' });
        const update = {}
        const { files } = req
        if (files?.profile?.length > 0) {
            const image = await uploadImageTos3('profile', files?.profile[0], 'upload');
            update.profile = image.data.Location;
        }
        if (order?.profile?.length > 0) {
            const dd = await deleteFileFroms3(decodeURIComponent(order?.profile))
            // console.log("dd", dd);
        }
        await db('users').where({ id: req.userId }).update(update);
        return res.status(200).json({ success: true, data: { url: update?.profile }, message: 'Update successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteMyAccount(req, res) {
    try {
        await db('users').where({ id: req.userId }).update({ deleted_at: new Date });
        await deleteKey(`user_${req.userId}`)
        return res.status(200).json({ success: true, data: null, message: 'Update successfully' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRecharge(req, res) {
    try {
        const [{ count }] = await db('payments')
            .count('* as count')
            .where({ user_id: req.userId })
            .whereIn('status', ['pending', 'success']);
        const rechargeNo = Number(count) + 1
        const recharges = await db('recharges')
            .whereIn('recharge_number', [1111, rechargeNo])
            .whereNull('deleted_at');
        const matchedRecharge =
            recharges.find(r => r.recharge_number === rechargeNo) ||
            recharges.find(r => r.recharge_number === 1111);

        if (!matchedRecharge) {
            return res.status(200).json({
                success: true,
                data: [],
                message: 'Recharge list success'
            });
        }
        const amounts = matchedRecharge?.amounts || [];
        return res.status(200).json({ success: true, data: amounts, message: 'Recharge list success' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRechargeBanner(req, res) {
    try {
        const userId = req.userId;
        const [{ count }] = await db('payments')
            .count('* as count')
            .where({ user_id: userId })
            .whereIn('status', ['pending', 'success']);
        const rechargeNo = Number(count) + 1;
        const recharges = await db('recharges')
            .whereIn('recharge_number', [1111, rechargeNo])
            .whereNull('deleted_at');
        const matchedRecharge =
            recharges.find(r => r.recharge_number === rechargeNo) ||
            recharges.find(r => r.recharge_number === 1111);

        // Last 5 unique pandits from orders (one row per pandit_id, most recent order first)


        if (!matchedRecharge) {

            const uniqueOrderRows = await db.raw(
                `SELECT pandit_id FROM (
                    SELECT pandit_id, id, ROW_NUMBER() OVER (PARTITION BY pandit_id ORDER BY id DESC) as rn
                    FROM orders
                    WHERE user_id = ? AND deleted_at IS NULL
                ) t WHERE rn = 1 ORDER BY id DESC LIMIT 5`,
                [userId]
            );
            const rows = uniqueOrderRows?.rows ?? uniqueOrderRows?.[0] ?? [];
            const panditIds = rows.map(r => r.pandit_id).filter(Boolean);

            let lastPandits = [];
            if (panditIds.length > 0) {
                const pandits = await db('pandits').whereIn('id', panditIds).select('id', 'display_name', 'profile');
                const panditMap = Object.fromEntries((pandits || []).map(p => [p.id, p]));
                lastPandits = await Promise.all(panditIds.map(async (panditId) => {
                    const lastMsg = await db('chats')
                        .whereNull('deleted_at')
                        .andWhere(function () {
                            this.where({ sender_type: 'user', sender_id: userId, receiver_type: 'pandit', receiver_id: panditId })
                                .orWhere({ sender_type: 'pandit', sender_id: panditId, receiver_type: 'user', receiver_id: userId });
                        })
                        .orderBy('id', 'desc')
                        .first('message', 'created_at');
                    const p = panditMap[panditId] || {};
                    return {
                        pandit_id: panditId,
                        display_name: p.display_name || null,
                        profile: p.profile || null,
                        last_message: lastMsg?.message || null,
                        last_message_at: lastMsg?.created_at || null,
                    };
                }));
            }

            return res.status(200).json({
                success: true,
                data: [],
                last_pandits: lastPandits,
                message: 'Recharge list success'
            });
        }
        const amounts = matchedRecharge?.amounts || [];
        return res.status(200).json({
            success: true,
            data: amounts,
            last_pandits: lastPandits,
            message: 'Recharge list success'
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { updateProfile, getProfile, getBalance, updateToken, profileUpdate, makeAvtarString, deleteMyAccount, getRecharge, getRechargeBanner };