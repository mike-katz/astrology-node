const db = require('../db');
require('dotenv').config();

async function getList(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 100;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;

        const faqs = await db.live('faqs')
            .orderBy('id', 'asc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await db.live('faqs').count('* as count');

        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: faqs
        };

        return res.status(200).json({ success: true, data: response, message: 'FAQ list retrieved successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getList };
