const db = require('../db');
const geoip = require('geoip-lite');
const { getClientIp } = require('../utils/getClientIp');
const { getCurrencyByCountry } = require('../utils/countryCurrencyMap');
require('dotenv').config();

async function getList(req, res) {
    try {
        let platform = req.query.platform;
        if (!platform) return res.status(400).json({ success: false, message: 'Missing params.' });

        const ip = getClientIp(req);
        let currency = null;
        if (ip) {
            const geo = geoip.lookup(ip);
            if (geo?.country) {
                currency = getCurrencyByCountry(geo.country)?.currency || null;
            }
        }

        let query = db('banners')
            .whereNull('deleted_at')
            .andWhere(function () {
                this.whereNull('currency').orWhere('currency', '');
                if (currency) this.orWhere('currency', currency);
            })
            .orderBy('id', 'asc');

        if (platform !== undefined && platform !== null && platform !== '') {
            const platforms = Array.isArray(platform) ? platform : [platform];
            const normalized = platforms.map(p => (typeof p === 'string' ? p.trim() : String(p))).filter(Boolean);
            if (normalized.length) query = query.whereIn('platform', normalized);
        }

        const banners = await query;

        return res.status(200).json({ success: true, data: banners, message: 'Banner list retrieved successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getList };
