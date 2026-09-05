const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const EN_BASE = 'https://astroapi-5.divineapi.com';
const TRANSLATOR_BASE = 'https://astroapi-5-translator.divineapi.com';

function resolveLan(req) {
    return String(req.query?.lan || req.query?.language || req.body?.lan || req.body?.language || 'en').trim() || 'en';
}

function getTarotBase(lan) {
    return String(lan).toLowerCase() === 'en' ? EN_BASE : TRANSLATOR_BASE;
}

function normalizeCardImage(value) {
    const n = Number(value);
    if (n === 1 || n === 2 || n === 3) return String(n);
    return '1';
}

function normalizeCardsCount(value) {
    const n = Number(value);
    if ([1, 2, 3, 4, 5].includes(n)) return String(n);
    return '1';
}

async function callDivineTarot(path, extra = {}, lan = 'en') {
    const formData = new FormData();
    formData.append('api_key', process.env.KUNDLI_API_KEY);
    formData.append('lan', lan);
    Object.entries(extra).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            formData.append(key, String(value));
        }
    });
    const response = await axios.post(`${getTarotBase(lan)}${path}`, formData, {
        headers: {
            Authorization: `Bearer ${process.env.KUNDLI_API_TOKEN}`,
            ...formData.getHeaders(),
        },
    });
    return response?.data;
}

function sendTarotError(res, err) {
    const data = err?.response?.data;
    console.error('tarot error:', data || err?.message || err);
    return res.status(err?.response?.status || 500).json({
        success: false,
        message: data?.msg || data?.message || err?.message || 'Server error',
        data: data || null,
    });
}

async function getDailyTarot(req, res) {
    try {
        const lan = resolveLan(req);
        const result = await callDivineTarot('/api/v2/daily-tarot', {}, lan);
        return res.status(200).json({ success: true, data: result?.data ?? result, message: 'Daily tarot fetched successfully.' });
    } catch (err) {
        return sendTarotError(res, err);
    }
}

async function getYesNoTarot(req, res) {
    try {
        const lan = resolveLan(req);
        const result = await callDivineTarot('/api/v2/yes-or-no-tarot', {}, lan);
        return res.status(200).json({ success: true, data: result?.data ?? result, message: 'Yes/No tarot fetched successfully.' });
    } catch (err) {
        return sendTarotError(res, err);
    }
}

async function getPastPresentFuture(req, res) {
    try {
        const lan = resolveLan(req);
        const card_image = normalizeCardImage(req.query?.card_image || req.body?.card_image);
        const result = await callDivineTarot('/api/v3/past-present-future-reading', { card_image }, lan);
        return res.status(200).json({ success: true, data: result?.data ?? result, message: 'Past-present-future reading fetched successfully.' });
    } catch (err) {
        return sendTarotError(res, err);
    }
}

async function getLoveTriangle(req, res) {
    try {
        const lan = resolveLan(req);
        const card_image = normalizeCardImage(req.query?.card_image || req.body?.card_image);
        const result = await callDivineTarot('/api/v2/love-triangle-reading', { card_image }, lan);
        return res.status(200).json({ success: true, data: result?.data ?? result, message: 'Love triangle reading fetched successfully.' });
    } catch (err) {
        return sendTarotError(res, err);
    }
}

async function getHeartbreak(req, res) {
    try {
        const lan = resolveLan(req);
        const card_image = normalizeCardImage(req.query?.card_image || req.body?.card_image);
        const result = await callDivineTarot('/api/v2/heartbreak-reading', { card_image }, lan);
        return res.status(200).json({ success: true, data: result?.data ?? result, message: 'Heartbreak reading fetched successfully.' });
    } catch (err) {
        return sendTarotError(res, err);
    }
}

async function getMadeForEachOther(req, res) {
    try {
        const lan = resolveLan(req);
        const card_image = normalizeCardImage(req.query?.card_image || req.body?.card_image);
        const cards_count = normalizeCardsCount(req.query?.cards_count || req.body?.cards_count);
        const result = await callDivineTarot('/api/v3/made-for-each-other-or-not-reading', { card_image, cards_count }, lan);
        return res.status(200).json({ success: true, data: result?.data ?? result, message: 'Made for each other reading fetched successfully.' });
    } catch (err) {
        return sendTarotError(res, err);
    }
}

module.exports = {
    getDailyTarot,
    getYesNoTarot,
    getPastPresentFuture,
    getLoveTriangle,
    getHeartbreak,
    getMadeForEachOther,
};
