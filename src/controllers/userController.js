const FormData = require('form-data');
const db = require('../db');
const axios = require('axios');
const { decodeJWT, convertCurrency } = require('../utils/decodeJWT');

require('dotenv').config();

const { deleteKey } = require('../config/redisClient');
const { uploadImageToAzure, deleteFileFromAzure } = require('../utils/azureUploader');
const { getCurrencySymbolByCurrency } = require('../utils/countryCurrencyMap');

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
    if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
    user.language = user?.language ? JSON.parse(user?.language) : [];
    user.my_interest = user?.my_interest ? JSON.parse(user?.my_interest) : [];
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
            await db.transaction(async (trx) => {
                const kundli = await trx('kundlis')
                    .where({ profile_id: isProfileExist?.id })
                    .first('id');
                if (kundli) {
                    await trx('kundlis').where({ id: kundli.id }).del();
                }
                const basicKundli = await trx('basickundlis')
                    .where({ profile_id: isProfileExist?.id })
                    .first('id');

                if (basicKundli) {
                    const kid = basicKundli.id;
                    const tables = [
                        'chalit_chart',
                        'dashakundlis',
                        'divisonal_chart',
                        'kpkundlis',
                        'lagna_chart',
                        'navamsa_chart',
                        'planetkundlis',
                        'reportkundlis',
                        'sookshma_dasha',
                        'transit_chart',
                        'ashtakvargakundlis'
                    ];
                    await Promise.all(
                        tables.map(table => trx(table).where({ kundli_id: kid }).del())
                    );
                    await trx('basickundlis').where({ id: kid }).del();
                }
            });
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
        .select('balance', 'default_currency')
        .first();
    if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
    const currency = user?.default_currency
    const currencyData = await db('currency').select('currency_name', 'user_inr_rate').where({ currency_name: currency }).first();

    const balance = await convertCurrency(user?.balance, (currencyData?.user_inr_rate || 1));
    user.balance = balance;
    const symbol = getCurrencySymbolByCurrency(currency)
    user.currency = symbol;

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
            const image = await uploadImageToAzure('profile', files?.profile[0], 'upload');
            update.profile = `${process.env.AZURE_STORAGE_BASE_URL}${image?.data?.key}`;
        }
        if (order?.profile?.length > 0) {
            const dd = await deleteFileFromAzure(decodeURIComponent(order?.profile))
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
        await db('users').where({ id: req.userId }).update({ status: "inactive" });
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
            .whereIn('status', ['success']);
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
        const userDetail = await db('users').where({ id: Number(req.userId) }).first();
        const amounts = matchedRecharge?.amounts[userDetail?.default_currency || 'INR'] || [];
        const symbol = getCurrencySymbolByCurrency(userDetail?.default_currency || 'INR')

        const currencyDetail = await db('currency').where({ currency_name: userDetail?.default_currency || 'INR' }).first();
        let gst = Number(currencyDetail?.user_tax_percentage || 0)
        let taxDetail = 'GST'
        if (userDetail?.default_currency != 'INR') {
            taxDetail = 'VAT'
        }
        return res.status(200).json({ success: true, data: { amounts, currency: symbol, gst, taxDetail }, message: 'Recharge list success' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRechargeBanner(req, res) {
    try {
        const userId = req.userId;
        console.log("getRechargeBanner api userId", userId);
        const [{ count }] = await db('payments')
            .count('* as count')
            .where({ user_id: userId })
            .whereIn('status', ['success']);
        // log
        const rechargeNo = Number(count) + 1;

        console.log("rechargeNo", rechargeNo);
        const recharges = await db('recharges')
            .whereIn('recharge_number', [rechargeNo])
            .whereNull('deleted_at');
        const matchedRecharge = recharges.find(r => r.recharge_number === rechargeNo);

        // console.log("matchedRecharge", matchedRecharge);
        // Last 5 unique orders (one per pandit, most recent first) – full order list for Flutter model


        if (!matchedRecharge) {

            const uniqueOrderRows = await db.raw(
                `SELECT id, pandit_id FROM (
                    SELECT pandit_id, id, ROW_NUMBER() OVER (PARTITION BY pandit_id ORDER BY id DESC) as rn
                    FROM orders
                    WHERE user_id = ? AND deleted_at IS NULL
                ) t WHERE rn = 1 ORDER BY id DESC LIMIT 5`,
                [userId]
            );
            const rows = uniqueOrderRows?.rows ?? uniqueOrderRows?.[0] ?? [];
            const orderIds = rows.map(r => r.id).filter(Boolean);
            const panditIds = [...new Set(rows.map(r => r.pandit_id).filter(Boolean))];

            let last_orders = [];
            if (orderIds.length > 0) {
                const orders = await db('orders').whereIn('id', orderIds).orderBy('id', 'desc');
                const orderMap = Object.fromEntries((orders || []).map(o => [o.id, o]));
                const pandits = await db('pandits').whereIn('id', panditIds).select('id', 'display_name', 'profile', 'waiting_time', 'online');
                const panditMap = Object.fromEntries((pandits || []).map(p => [p.id, p]));

                last_orders = await Promise.all(orderIds.map(async (orderId) => {
                    const order = orderMap[orderId] || {};
                    const panditId = order.pandit_id;
                    const p = panditMap[panditId] || {};

                    return {
                        id: order.id ?? null,
                        panditId: order.pandit_id ?? null,
                        userId: order.user_id ?? null,
                        orderId: order.order_id ?? null,
                        status: order.status ?? null,
                        type: order.type ?? null,
                        isAccept: order.is_accept ?? null,
                        rate: order.rate ?? null,
                        endTime: order.end_time ? new Date(order.end_time).toISOString() : null,
                        startTime: order.start_time ? new Date(order.start_time).toISOString() : null,
                        duration: order.duration ?? null,
                        deduction: order.deduction ?? null,
                        deletedAt: order.deleted_at ? new Date(order.deleted_at).toISOString() : null,
                        createdAt: order.created_at ? new Date(order.created_at).toISOString() : null,
                        profileId: order.profile_id ?? null,
                        updatedAt: order.updated_at ? new Date(order.updated_at).toISOString() : null,
                        name: p.display_name ?? null,
                        profile: p.profile ?? null,
                        online: p.online,

                    };
                }));
            }
            return res.status(200).json({
                success: true,
                data: { last_orders, banner: "" },
                message: 'Recharge list success'
            });
        }
        const banner = matchedRecharge?.banner ?? '';
        return res.status(200).json({
            success: true,
            data: { banner, last_orders: [] },
            message: 'Recharge list success'
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getCookie(req, res) {
    const { language = 'en' } = req.query;
    const formData = new FormData();

    formData.append('api_key', process.env.KUNDLI_API_KEY);
    formData.append('lan', language);
    const config = {
        method: 'post',
        url: "https://astroapi-5-translator.divineapi.com/api/v2/fortune-cookie",
        headers: {
            Authorization: `Bearer ${process.env.KUNDLI_API_TOKEN}`,
            ...formData.getHeaders(),
        },
        data: formData,
    };
    // console.log("config", config);
    const response = await axios(config);
    // console.log("response", response.data);

    return res.status(200).json({ success: true, data: response?.data?.data?.prediction, message: 'Recharge list success' });
}

async function getRecommendations(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;
        const { category_id, title, category } = req.query;

        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const offset = (page - 1) * limit;

        const filter = { user_id: req.userId };

        // Filter by category if provided


        let query = db('recommendations as b')
            .where(filter);

        let countQuery = db('recommendations as b')
            .leftJoin('pandits as c', 'c.id', 'b.pandit_id')
            .where(filter);

        // Filter by title if provided


        const blogs = await query
            .leftJoin('pandits as c', 'c.id', 'b.pandit_id')
            .select('b.id', 'b.title', 'b.main_price', 'b.price', 'b.created_at', 'b.review', 'b.url', 'c.display_name as name', 'c.profile', 'b.pandit_id')
            .orderBy('b.id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await countQuery.count('* as count');

        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);
        const response = {
            page,
            limit,
            total,
            totalPages,
            results: blogs
        };

        return res.status(200).json({
            success: true,
            data: response,
            message: 'recommendation list fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function findIsFree(req, res) {
    try {
        const existing = await db('users').where({ id: req.userId }).select('is_free_order_available', 'id', 'default_currency').first();
        const is_free = existing?.is_free_order_available || false;
        const response = { is_free, is_offer: false, offer_detail: {} }
        if (is_free) {
            const setting = await db('settings').select('currency_amount').first();

            setting?.currency_amount?.map(item => {
                if (item?.currency == existing?.default_currency || "INR") {
                    response.is_offer = true
                    response.offer_detail = item
                }
            })
        }
        return res.status(200).json({ success: true, data: response, message: 'Get successfully' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

/** Logged-in user dashboard counts / summary */
async function getUserStats(req, res) {
    try {
        const userId = req.userId;

        const rechargeBase = db('payments')
            .where({ user_id: userId, status: 'success', type: 'recharge' })
            .whereNull('deleted_at');

        // const [
        //     rechargeAgg,
        //     favouriteAgg,
        //     orderAgg,
        //     lastConsultation,
        //     remedyCountRow,
        //     remedies,
        //     giftCountRow,
        // ] = await Promise.all([
        //     rechargeBase
        //         .clone()
        //         .select(
        //             db.raw('COUNT(*)::int as recharge_count'),
        //             db.raw('COALESCE(SUM(amount), 0) as total_recharge_amount'),
        //             db.raw('MAX(COALESCE(updated_at, created_at)) as last_recharge_date'),
        //         )
        //         .first(),
        //     db('follows')
        //         .where({ user_id: userId, type: 'user' })
        //         .count('* as count')
        //         .first(),
        //     db('orders')
        //         .where({ user_id: userId })
        //         .whereNull('deleted_at')
        //         .whereNot('status', 'cancel')
        //         .count('* as count')
        //         .first(),
        //     db('orders')
        //         .where({ user_id: userId, status: 'completed' })
        //         .whereNull('deleted_at')
        //         .select(db.raw('MAX(COALESCE(end_time, updated_at, created_at)) as last_consultation_date'))
        //         .first(),
        //     db('recommendations')
        //         .where({ user_id: userId })
        //         .count('* as count')
        //         .first(),
        //     db('recommendations as b')
        //         .leftJoin('pandits as c', 'c.id', 'b.pandit_id')
        //         .where({ 'b.user_id': userId })
        //         .select(
        //             'b.id',
        //             'b.title',
        //             'b.main_price',
        //             'b.price',
        //             'b.created_at',
        //             'b.review',
        //             'b.url',
        //             'b.pandit_id',
        //             'c.display_name as name',
        //             'c.profile',
        //         )
        //         .orderBy('b.id', 'desc'),
        //     db('balancelogs')
        //         .where({ user_id: userId })
        //         .whereNull('deleted_at')
        //         .where('message', 'like', 'Send gift%')
        //         .count('* as count')
        //         .first(),
        // ]);

        // const data = {
        //     recharge_count: Number(rechargeAgg?.recharge_count || 0),
        //     total_recharge_amount: Number(rechargeAgg?.total_recharge_amount || 0),
        //     last_recharge_date: rechargeAgg?.last_recharge_date || null,
        //     total_favourite_astrologers: Number(favouriteAgg?.count || 0),
        //     last_consultation_date: lastConsultation?.last_consultation_date || null,
        //     total_order_count: Number(orderAgg?.count || 0),
        //     recommend_remedy_count: Number(remedyCountRow?.count || 0),
        //     recommend_remedy: remedies || [],
        //     send_gift_count: Number(giftCountRow?.count || 0),
        // };

        const data = {
            recharge_count: 0,
            total_recharge_amount: 0,
            last_recharge_date: '2026-06-10',
            total_favourite_astrologers: 0,
            last_consultation_date: '2026-06-09',
            total_order_count: 0,
            recommend_remedy_count: 0,
            recommend_remedy: "",
            send_gift_count: 0,
        };

        return res.status(200).json({
            success: true,
            data,
            message: 'User stats fetched successfully',
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getCurrencyList(req, res) {
    try {
        const authHeader = req.headers.authorization;
        const tokenData = decodeJWT(authHeader);
        const result = tokenData?.currency !== 'INR'
            ? await db('currency').select('*')
            : [];

        return res.status(200).json({
            success: true,
            data: result,
            message: 'Currency successful',
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function updateCurrency(req, res) {
    try {
        const { currency } = req.body
        const user = await db('users')
            .where('id', Number(req?.userId))
            .first();
        if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
        const currencyData = await db('currency').where({ currency_name: currency }).whereNull('deleted_at').first();
        if (!currencyData) return res.status(400).json({ success: false, message: 'Please enter correct currency.' });

        await db('users').where({ id: Number(req?.userId) }).update({ default_currency: currency })

        return res.status(200).json({
            success: true,
            data: null,
            message: 'User currency successfully',
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getGiftList(req, res) {
    try {
        const authHeader = req.headers.authorization;
        const tokenData = decodeJWT(authHeader);
        const currency = tokenData?.data?.currency || 'INR'
        let result = await db('gifts').where({ currency }).whereNull('deleted_at')
        if (result?.length > 0) {
            const symbol = getCurrencySymbolByCurrency(currency)
            result.map(item => {
                item.currency = symbol
            })
        }
        return res.status(200).json({
            success: true,
            data: result,
            message: 'gift successful',
        });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}



module.exports = { updateProfile, getProfile, getBalance, updateToken, profileUpdate, makeAvtarString, deleteMyAccount, getRecharge, getRechargeBanner, getCookie, getRecommendations, findIsFree, getUserStats, getCurrencyList, updateCurrency, getGiftList };
