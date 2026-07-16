const db = require('../db');
const { deepParse } = require('../utils/decodeJWT');
const { createOrder } = require('./remedyOrderController');

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

        const filter = {
            remedy_id: Number(remedy_id),
            status: true,
        };

        let query = db('astroremedypoojas').where(filter).whereNull('deleted_at');
        let countQuery = db('astroremedypoojas').where(filter).whereNull('deleted_at');

        if (name?.trim()) {
            query = query.where('name', 'ilike', `%${name.trim()}%`);
            countQuery = countQuery.where('name', 'ilike', `%${name.trim()}%`);
        }

        const rows = await query
            .select('id', 'remedy_id', 'name', 'amount', 'discount', 'image')
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
            amount: Number(item.amount),
            discount: Number(item.discount || 0),
            image: getFirstImage(item.image),
        }));

        return res.status(200).json({
            success: true,
            data: {
                page,
                limit,
                total,
                totalPages,
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
                'p.description',
                'p.created_at',
                'r.name as remedy_name',
                'r.image as remedy_image',
                'r.tag as remedy_tag'
            )
            .where({ 'p.id': Number(id), 'p.status': true })
            .whereNull('p.deleted_at')
            .whereNull('r.deleted_at')
            .first();

        if (!item) {
            return res.status(400).json({ success: false, message: 'Remedy item not found.' });
        }

        const reviews = await db('astroremedireviews as ar')
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
            .where({ 'ar.pooja_id': Number(id) })
            .orderBy('ar.id', 'desc');

        const data = {
            id: item.id,
            remedy_id: item.remedy_id,
            remedy_name: item.remedy_name,
            remedy_image: item.remedy_image,
            remedy_tag: item.remedy_tag,
            name: item.name,
            amount: Number(item.amount),
            discount: Number(item.discount || 0),
            tag: deepParse(item.tag),
            duration: item.duration,
            pooja_type: item.pooja_type,
            highlight: item.highlight,
            description: item.description,
            images: parseImageList(item.image),
            image: getFirstImage(item.image),
            created_at: item.created_at,
            reviews,
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
        const { id, pandit_id } = req.body;
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

        const reviews = await db('remedy_faqs')
            .where({ type })
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
