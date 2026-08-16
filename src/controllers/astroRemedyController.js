const db = require('../db');
const { deepParse, convertCurrency } = require('../utils/decodeJWT');
const { createOrder } = require('./remedyOrderController');
const { getCurrencySymbolByCurrency } = require('../utils/countryCurrencyMap');
require('dotenv').config();

async function resolveUserCurrency(req) {
    if (!req.userId) return 'INR';
    const userData = await db('users').select('default_currency').where({ id: Number(req.userId) }).first();
    return userData?.default_currency || 'INR';
}

function getFirstImage(image) {
    if (!image) return null;
    const parsed = deepParse(image);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    return null;
}

function parseImageList(image) {
    if (!image) return [];
    const parsed = deepParse(image);
    return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
}

function parsePanditIds(panditId) {
    if (!panditId) return [];
    const parsed = deepParse(panditId);
    const ids = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    return ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id) && id > 0);
}

function calculateRating(pandit) {
    const r1 = Number(pandit.rating_1 || 0);
    const r2 = Number(pandit.rating_2 || 0);
    const r3 = Number(pandit.rating_3 || 0);
    const r4 = Number(pandit.rating_4 || 0);
    const r5 = Number(pandit.rating_5 || 0);
    const total = r1 + r2 + r3 + r4 + r5;
    if (total === 0) return 0;
    const weighted = (r1 + r2 * 2 + r3 * 3 + r4 * 4 + r5 * 5) / total;
    return Number(weighted.toFixed(1));
}

async function getPanditFromIds(panditIds) {
    if (!panditIds.length) return null;

    const pandit = await db('pandits')
        .select('id', 'profile', 'display_name', 'rating_1', 'rating_2', 'rating_3', 'rating_4', 'rating_5', 'total_orders')
        .whereIn('id', panditIds)
        .whereNull('deleted_at')
        .orderByRaw(`array_position(ARRAY[${panditIds.join(',')}]::int[], id)`);

    if (!pandit) return null;

    const result = []
    pandit.map(item => {
        result.push({
            id: item.id,
            profile: item.profile,
            display_name: item.display_name,
            rating: calculateRating(item),
            total_orders: Number(item.total_orders || 0),
        })
    })
    return result
}

async function getRemedyList(req, res) {
    try {
        const remedies = await db('astroremedies')
            .select('id', 'name', 'image', 'tag')
            .where({ status: true })
            .whereNull('deleted_at')
            .orderBy('id', 'asc');

        return res.status(200).json({
            success: true,
            data: remedies,
            message: 'Astro remedy list fetched successfully.',
        });
    } catch (err) {
        console.error('getRemedyList:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRemedyItems(req, res) {
    try {
        const { remedy_id, name } = req.query;
        console.log("req.query", req.query);
        if (!remedy_id) {
            return res.status(400).json({ success: false, message: 'Remedy id is required.' });
        }

        let page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 20;
        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const offset = (page - 1) * limit;

        const remedy = await db('astroremedies')
            .where({ id: Number(remedy_id), status: true })
            .whereNull('deleted_at')
            .first();
        if (!remedy) {
            return res.status(400).json({ success: false, message: 'Astro remedy not found.' });
        }

        const currency = await resolveUserCurrency(req);
        const currencyData = await db('currency')
            .select('currency_name', 'user_inr_rate', 'pandit_inr_rate')
            .where({ currency_name: currency })
            .first();
        // same convert pattern as pandit list; user-facing prices use user_inr_rate (checkout)
        const rate = currencyData?.pandit_inr_rate || 1;
        const symbol = getCurrencySymbolByCurrency(currency);

        const filter = {
            remedy_id: Number(remedy_id),
            status: true,
        };

        const now = new Date();
        const applySamuhikTimeFilter = (q) => q.andWhere(function () {
            // non-samuhik: always show
            this.whereRaw("LOWER(COALESCE(pooja_type, '')) <> ?", ['samuhik'])
                // samuhik: only if pooja_time is still in the future
                .orWhere(function () {
                    this.whereRaw("LOWER(pooja_type) = ?", ['samuhik'])
                        .andWhere('pooja_time', '>', now);
                });
        });

        let query = applySamuhikTimeFilter(
            db('astroremedypoojas').where(filter).whereNull('deleted_at')
        );
        let countQuery = applySamuhikTimeFilter(
            db('astroremedypoojas').where(filter).whereNull('deleted_at')
        );

        if (name?.trim()) {
            query = query.where('name', 'ilike', `%${name.trim()}%`);
            countQuery = countQuery.where('name', 'ilike', `%${name.trim()}%`);
        }

        const rows = await query
            .select('id', 'remedy_id', 'name', 'amount', 'discount', 'image', 'total_orders', 'pooja_type', 'pooja_time')
            .orderBy('id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await countQuery.count('* as count');
        const total = parseInt(count, 10);
        const totalPages = Math.ceil(total / limit);

        const results = rows.map((item) => ({
            id: item.id,
            remedy_id: item.remedy_id,
            name: item.name,
            amount: convertCurrency(item.amount, rate),
            discount: convertCurrency(item.discount || 0, rate),
            currency: symbol,
            total_orders: Number(item.total_orders || 0),
            pooja_type: item.pooja_type,
            pooja_time: item.pooja_time,
            image: getFirstImage(item.image),
        }));

        return res.status(200).json({
            success: true,
            data: {
                page,
                limit,
                total,
                totalPages,
                currency: symbol,
                remedy: {
                    id: remedy.id,
                    name: remedy.name,
                    image: remedy.image,
                    tag: remedy.tag,
                },
                results,
            },
            message: 'Remedy items fetched successfully.',
        });
    } catch (err) {
        console.error('getRemedyItems:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRemedyDetail(req, res) {
    try {
        const { id } = req.query;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Item id is required.' });
        }

        const item = await db('astroremedypoojas as p')
            .leftJoin('astroremedies as r', 'r.id', 'p.remedy_id')
            .select(
                'p.id',
                'p.remedy_id',
                'p.name',
                'p.image',
                'p.tag',
                'p.duration',
                'p.pandit_id',
                'p.amount',
                'p.discount',
                'p.pooja_type',
                'p.highlight',
                'p.call_type',
                'p.is_ashirvad',
                'p.price_array',
                'p.description',
                'p.location',
                'p.pooja_time',
                'p.total_orders',
                'p.recent_orders',
                'p.created_at',
                'r.name as remedy_name',
                'r.image as remedy_image',
                'r.tag as remedy_tag',
                'r.call_type as category_call_type',
                'r.is_ashirvad as category_is_ashirvad',
            )
            .where({ 'p.id': Number(id), 'p.status': true })
            .whereNull('p.deleted_at')
            .whereNull('r.deleted_at')
            .first();

        if (!item) {
            return res.status(400).json({ success: false, message: 'Remedy item not found.' });
        }

        const currency = await resolveUserCurrency(req);
        const currencyData = await db('currency')
            .select('currency_name', 'user_inr_rate', 'pandit_inr_rate')
            .where({ currency_name: currency })
            .first();
        const rate = currencyData?.pandit_inr_rate || 1;
        const symbol = getCurrencySymbolByCurrency(currency);

        const [reviews, faqs, recentOrderRows] = await Promise.all([
            db('astroremedireviews as ar')
                .leftJoin('users as u', 'u.id', 'ar.user_id')
                .select(
                    'ar.id',
                    'ar.rating',
                    'ar.message',
                    'ar.created_at',
                    'u.name',
                    'u.profile',
                    'u.avatar'
                )
                .where({ 'ar.pooja_id': Number(id), 'ar.status': 'approved' })
                .orderBy('ar.id', 'desc'),
            db('faqs')
                .where({ type: 'pooja' })
                .whereNull('deleted_at')
                .orderBy('id', 'desc'),
            db('remedy_orders as ro')
                .leftJoin('users as u', 'u.id', 'ro.user_id')
                .select('u.name')
                .where({ 'ro.pooja_id': Number(id) })
                .whereNull('ro.deleted_at')
                .orderBy('ro.id', 'desc')
                .limit(5),
        ]);

        // total 5: real order users first, then fill from pooja.recent_orders (skip first)
        const recent_orders = [];
        for (const row of recentOrderRows) {
            if (recent_orders.length >= 5) break;
            recent_orders.push(String(row?.name || '').trim() || 'User');
        }

        let storedRecent = item.recent_orders;
        if (typeof storedRecent === 'string') {
            try {
                storedRecent = JSON.parse(storedRecent);
            } catch (e) {
                storedRecent = [];
            }
        }
        if (!Array.isArray(storedRecent)) storedRecent = [];

        // first skip, then fill remaining slots up to 5
        for (const name of storedRecent.slice(1)) {
            if (recent_orders.length >= 5) break;
            recent_orders.push(String(name || '').trim() || 'User');
        }

        let priceArray = deepParse(item.price_array);
        if (Array.isArray(priceArray)) {
            priceArray = priceArray.map((p) => ({
                ...p,
                amount: convertCurrency(p?.amount || 0, rate),
                discount: convertCurrency(p?.discount || 0, rate),
            }));
        } else {
            priceArray = item.price_array;
        }

        const data = {
            id: item.id,
            remedy_id: item.remedy_id,
            remedy_name: item.remedy_name,
            remedy_image: item.remedy_image,
            remedy_tag: item.remedy_tag,
            name: item.name,
            amount: convertCurrency(item.amount, rate),
            discount: convertCurrency(item.discount || 0, rate),
            currency: symbol,
            tag: deepParse(item.tag),
            duration: item.duration,
            pooja_type: item.pooja_type,
            highlight: item.highlight,
            description: item.description,
            images: parseImageList(item.image),
            image: getFirstImage(item.image),
            call_type: item.call_type,
            is_ashirvad: item.is_ashirvad,
            price_array: priceArray,
            category_call_type: item.category_call_type,
            category_is_ashirvad: item.category_is_ashirvad,
            created_at: item.created_at,
            location: item.location,
            pooja_time: item.pooja_time,
            total_orders: Number(item.total_orders || 0),
            recent_orders,
            reviews,
            faqs,
            pandit_inr_rate: rate
        };
        if (item?.pooja_type == 'spells') {
            const panditIds = parsePanditIds(item.pandit_id);
            const pandit = await getPanditFromIds(panditIds);
            data.pandit_id = panditIds
            data.pandit = pandit
        }

        return res.status(200).json({
            success: true,
            data,
            message: 'Remedy detail fetched successfully.',
        });
    } catch (err) {
        console.error('getRemedyDetail:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRemedyOrderCreate(req, res) {
    try {
        const { id, pandit_id, is_ashirvad, person, pincode, city, state, address, landmark, mobile } = req.body;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Item id is required.' });
        }

        const item = await db('astroremedypoojas')
            .where({ id: Number(id), status: true })
            .whereNull('deleted_at')
            .first();
        if (!item) {
            return res.status(400).json({ success: false, message: 'Remedy item not found.' });
        }

        req.body.pooja_id = Number(id);
        req.body.pandit_id = pandit_id;
        req.body.is_ashirvad = is_ashirvad;
        req.body.person = person;
        req.body.pincode = pincode;
        req.body.city = city;
        req.body.state = state;
        req.body.address = address;
        req.body.landmark = landmark;
        req.body.mobile = mobile;
        return createOrder(req, res);
    } catch (err) {
        console.error('getRemedyOrderCreate:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRemedyFaq(req, res) {
    try {
        const { type } = req.query;
        if (!type) {
            return res.status(400).json({ success: false, message: 'Item id is required.' });
        }

        const reviews = await db('faqs')
            .where({ type: "pooja" })
            .orderBy('id', 'desc');
        return res.status(200).json({
            success: true,
            data: reviews,
            message: 'Remedy faq fetched successfully.',
        });
    } catch (err) {
        console.error('getRemedyDetail:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRemedyHowItWorks(req, res) {
    try {
        const reviews = await db('remedyhowitworks')
            .orderBy('id', 'desc');
        return res.status(200).json({
            success: true,
            data: reviews,
            message: 'fetched successfully.',
        });
    } catch (err) {
        console.error('remedyhowitworks:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}


module.exports = { getRemedyList, getRemedyItems, getRemedyDetail, getRemedyOrderCreate, getRemedyFaq, getRemedyHowItWorks };
