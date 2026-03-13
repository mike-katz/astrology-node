const db = require('../db');
require('dotenv').config();
const { decodeJWT } = require('../utils/decodeJWT');
const axios = require('axios');
const FormData = require('form-data');

const safeParse = (val) => {
    if (val == null) return null;
    if (typeof val === 'object') return val;
    try { return JSON.parse(val); } catch { return val; }
};

/** Required basickundlis columns for chart API calls (must exist in migration) */
const REQUIRED_KUNDLI_API_PARAMS = ['lat', 'lng', 'dob', 'birth_time', 'name', 'gender', 'birth_place', 'language'];

function validateKundliParams(kundli) {
    const missing = REQUIRED_KUNDLI_API_PARAMS.filter((key) => kundli[key] == null || kundli[key] === '');
    if (missing.length) return { valid: false, message: `Missing required kundli params: ${missing.join(', ')}` };
    return { valid: true };
}

async function basicKundliApiCall(language = 'en', lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam = []) {

    lat = lat ?? '22.82';
    lng = lng ?? '70.84';
    const formData = new FormData();
    const [year, month, day] = dob.split('-');
    const [hour, min, sec] = birth_time.split(':');

    formData.append('api_key', process.env.KUNDLI_API_KEY);
    formData.append('full_name', name);
    formData.append('day', day);
    formData.append('month', month);
    formData.append('year', year);
    formData.append('hour', hour);
    formData.append('min', min);
    formData.append('sec', sec || 0);
    formData.append('gender', gender);
    formData.append('place', birth_place);
    formData.append('lat', lat);
    formData.append('lon', lng);
    formData.append('tzone', '5.5');
    formData.append('lan', language);

    if (extraparam?.length > 0) {
        extraparam.map(item => {
            formData.append(item.key, item.value);
        })
    }
    const config = {
        method: 'post',
        url,
        headers: {
            Authorization: `Bearer ${process.env.KUNDLI_API_TOKEN}`,
            ...formData.getHeaders(),
        },
        data: formData,
    };
    // console.log("config", config);
    const response = await axios(config);
    // console.log("response", response.data);
    return response?.data
}

async function findBasicKundli(req, res) {
    try {
        let { profile_id, name, dob, type, birth_time, gender, birth_place, lat = '22.82', lng = '70.84', language = 'en' } = req.query;

        // console.log("req.query", req.query);
        if (!type) return res.status(400).json({ success: false, message: 'Missing params.' });

        const authHeader = req.headers.authorization;
        // console.log("authHeader", authHeader);
        const url = 'https://astroapi-3.divineapi.com/indian-api/v3/basic-astro-details'
        if (type == 'profile' && !authHeader?.startsWith('Bearer ')) {
            return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        if (authHeader && type == 'profile' && authHeader.startsWith('Bearer ')) {
            // console.log("authHeader", authHeader);
            const tokenData = decodeJWT(authHeader)
            if (!tokenData?.success || !tokenData?.data?.userId) return res.status(400).json({ success: false, message: 'Your session expired.' });
            const user = await db('userprofiles')
                .where({ 'id': Number(profile_id), user_id: tokenData?.data?.userId })
                .first();
            if (!user) return res.status(400).json({ success: false, message: 'Your session expired.' });
            const date = new Date(user?.dob).toISOString().slice(0, 10);

            name = user?.name
            gender = user?.gender
            birth_time = user?.birth_time
            dob = date
            birth_place = user?.birth_place
            lat = user?.lat || lat
            lng = user?.lng || lng

            let kundli = await db('kundlis')
                .where({ profile_id, language }).select('dob', 'birth_time', 'name', 'gender', 'birth_place', 'basic', 'ghata_chakra', 'id')
                .first();

            if (user?.is_updated || !kundli) {
                const [response, ghataChakra] = await Promise.all([
                    basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url),
                    basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, 'https://astroapi-3.divineapi.com/indian-api/v1/ghata-chakra')
                ]);
                kundli = { ...kundli, name, gender, dob, birth_place, birth_time, lng, lat, language, profile_id: Number(profile_id) }
                kundli.basic = JSON.stringify(response?.data)
                kundli.ghata_chakra = JSON.stringify(ghataChakra?.data)

                // console.log("kundli", kundli);
                if (kundli.id) {
                    await db('kundlis')
                        .where({ id: kundli.id }).update(kundli)
                } else {
                    const [saved] = await db('kundlis')
                        .insert(kundli).returning("*");
                    kundli.id = saved.id
                }
                await db('userprofiles').where({ 'id': Number(profile_id) }).update({ is_updated: false })
            }
            kundli.basic = JSON.parse(kundli.basic)
            kundli.ghata_chakra = JSON.parse(kundli?.ghata_chakra)

            return res.status(200).json({ success: true, data: kundli, message: 'Kundli get Successfully' });
        }
        let user = await db('kundlis')
            .where({ name, gender, dob, birth_place, birth_time, language })
            .select('dob', 'birth_time', 'name', 'gender', 'birth_place', 'basic', 'ghata_chakra', 'language', 'id')
            .first();

        if (!user) {
            const [response, ghataChakra] = await Promise.all([
                basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url),
                basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, 'https://astroapi-3.divineapi.com/indian-api/v1/ghata-chakra')
            ]);
            user = { name, gender, dob, birth_place, birth_time, lat, lng, language }
            if (profile_id) {
                user.profile_id = profile_id
            }
            user.basic = JSON.stringify(response?.data)
            user.ghata_chakra = JSON.stringify(ghataChakra?.data)
            const [saved] = await db('kundlis').insert(user).returning("*");
            // await db('follows').insert({ user_id: req?.userId, pandit_id: panditId, type: "user" });
            user.id = saved.id
        }
        // console.log("user", user);
        user.basic = JSON.parse(user.basic)
        user.ghata_chakra = JSON.parse(user.ghata_chakra)
        return res.status(200).json({ success: true, data: user, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function findkundliTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('kundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { dob, birth_time, name, gender, language, birth_place, birth_chart, lat, lng, south_birth_chart, navamsa_chart, south_navamsa_chart, planets, sookshma_dasha } = kundli
        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const allTasks = [
            { key: 'birth_chart', url: base + '/v1/horoscope-chart/D1', extraparam: [{ key: 'chart_type', value: 'north' }] },
            { key: 'navamsa_chart', url: base + '/v1/horoscope-chart/D9', extraparam: [{ key: 'chart_type', value: 'north' }] },
            { key: 'south_birth_chart', url: base + '/v1/horoscope-chart/D1', extraparam: [{ key: 'chart_type', value: 'south' }] },
            { key: 'south_navamsa_chart', url: base + '/v1/horoscope-chart/D9', extraparam: [{ key: 'chart_type', value: 'south' }] },
            { key: 'planets', url: base + '/v2/planetary-positions', extraparam: [] },
            { key: 'sookshma_dasha', url: base + '/v1/vimshottari-dasha', extraparam: [{ key: 'dasha_type', value: 'sookshma-dasha' }] },
        ];
        const tasks = allTasks.filter(t => kundli[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });
        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }
        const response = { id: kundli_id };
        allTasks.forEach(t => { response[t.key] = safeParse(kundli[t.key]); });
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function findkpTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('kundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;
        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const allTasks = [
            { key: 'chalit_chart', url: base + '/v1/horoscope-chart/chalit', extraparam: [] },
            { key: 'ruling_planet', url: base + '/v2/kp/planetary-positions', extraparam: [] },
            { key: 'kp_planet', url: base + '/v2/kp/planetary-positions', extraparam: [] },
            { key: 'kp_cusps', url: base + '/v2/kp/cuspal', extraparam: [] },
        ];
        const tasks = allTasks.filter(t => kundli[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });
        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }
        const response = { id: kundli_id };
        allTasks.forEach(t => { response[t.key] = safeParse(kundli[t.key]); });
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function findAshtakvargaTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('kundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, birth_time, language, name, gender, birth_place, ashtakvarga } = kundli
        const upd = {}
        if (ashtakvarga == null) {
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/bhinnashtakvarga/ashtakvarga'
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl)
            upd.ashtakvarga = JSON.stringify(chalitChartresponse?.data?.chart);
        }

        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }

        const response = {
            id: kundli_id,
            ashtakvarga: JSON.parse(kundli.ashtakvarga),
        }
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function findChartTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('kundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        const [year, month, day] = dob.split('-');
        const transitNorth = [
            { key: 'transit_year', value: year },
            { key: 'transit_month', value: month },
            { key: 'transit_day', value: day },
            { key: 'chart_type', value: 'north' }
        ];
        const transitSouth = [
            { key: 'transit_year', value: year },
            { key: 'transit_month', value: month },
            { key: 'transit_day', value: day },
            { key: 'chart_type', value: 'south' }
        ];
        const northParam = [{ key: 'chart_type', value: 'north' }];
        const southParam = [{ key: 'chart_type', value: 'south' }];
        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const baseChart = base + '/horoscope-chart';

        const allTasks = [
            { key: 'transit_ascendant', url: base + '/kundli-transit/ascendant', extraparam: transitNorth, type: 'svg' },
            { key: 'transit_moon', url: base + '/kundli-transit/moon', extraparam: transitNorth, type: 'svg' },
            { key: 'south_transit_ascendant', url: base + '/kundli-transit/ascendant', extraparam: transitSouth, type: 'svg' },
            { key: 'south_transit_moon', url: base + '/kundli-transit/moon', extraparam: transitSouth, type: 'svg' },
            { key: 'chalit_chart', url: baseChart + '/chalit', extraparam: northParam, type: 'svg' },
            { key: 'sun_chart', url: baseChart + '/SUN', extraparam: northParam, type: 'svg' },
            { key: 'moon_chart', url: baseChart + '/MOON', extraparam: northParam, type: 'svg' },
            { key: 'birth_chart', url: baseChart + '/D1', extraparam: northParam, type: 'svg' },
            { key: 'hora_chart', url: baseChart + '/D2', extraparam: northParam, type: 'svg' },
            { key: 'drekkana_chart', url: baseChart + '/D3', extraparam: northParam, type: 'svg' },
            { key: 'chaturthamsha_chart', url: baseChart + '/D4', extraparam: northParam, type: 'svg' },
            { key: 'saptamsa_chart', url: baseChart + '/D7', extraparam: northParam, type: 'svg' },
            { key: 'navamsa_chart', url: baseChart + '/D9', extraparam: northParam, type: 'svg' },
            { key: 'dasamsa_chart', url: baseChart + '/D10', extraparam: northParam, type: 'svg' },
            { key: 'dwadasamsa_chart', url: baseChart + '/D12', extraparam: northParam, type: 'svg' },
            { key: 'shodasamsa_chart', url: baseChart + '/D16', extraparam: northParam, type: 'svg' },
            { key: 'vimsamsa_chart', url: baseChart + '/D20', extraparam: northParam, type: 'svg' },
            { key: 'chaturvimsamsa_chart', url: baseChart + '/D24', extraparam: northParam, type: 'svg' },
            { key: 'saptavimsamsa_chart', url: baseChart + '/D27', extraparam: northParam, type: 'svg' },
            { key: 'trimsamsa_chart', url: baseChart + '/D30', extraparam: northParam, type: 'svg' },
            { key: 'khavedamsa_chart', url: baseChart + '/D40', extraparam: northParam, type: 'svg' },
            { key: 'akshavedamsa_chart', url: baseChart + '/D45', extraparam: northParam, type: 'svg' },
            { key: 'shastiamsa_chart', url: baseChart + '/D60', extraparam: northParam, type: 'svg' },
            { key: 'south_chalit_chart', url: baseChart + '/chalit', extraparam: southParam, type: 'svg' },
            { key: 'south_sun_chart', url: baseChart + '/SUN', extraparam: southParam, type: 'svg' },
            { key: 'south_moon_chart', url: baseChart + '/MOON', extraparam: southParam, type: 'svg' },
            { key: 'south_birth_chart', url: baseChart + '/D1', extraparam: southParam, type: 'svg' },
            { key: 'south_hora_chart', url: baseChart + '/D2', extraparam: southParam, type: 'svg' },
            { key: 'south_drekkana_chart', url: baseChart + '/D3', extraparam: southParam, type: 'svg' },
            { key: 'south_chaturthamsha_chart', url: baseChart + '/D4', extraparam: southParam, type: 'svg' },
            { key: 'south_saptamsa_chart', url: baseChart + '/D7', extraparam: southParam, type: 'svg' },
            { key: 'south_navamsa_chart', url: baseChart + '/D9', extraparam: southParam, type: 'svg' },
            { key: 'south_dasamsa_chart', url: baseChart + '/D10', extraparam: southParam, type: 'svg' },
            { key: 'south_dwadasamsa_chart', url: baseChart + '/D12', extraparam: southParam, type: 'svg' },
            { key: 'south_shodasamsa_chart', url: baseChart + '/D16', extraparam: southParam, type: 'svg' },
            { key: 'south_vimsamsa_chart', url: baseChart + '/D20', extraparam: southParam, type: 'svg' },
            { key: 'south_chaturvimsamsa_chart', url: baseChart + '/D24', extraparam: southParam, type: 'svg' },
            { key: 'south_saptavimsamsa_chart', url: baseChart + '/D27', extraparam: southParam, type: 'svg' },
            { key: 'south_trimsamsa_chart', url: baseChart + '/D30', extraparam: southParam, type: 'svg' },
            { key: 'south_khavedamsa_chart', url: baseChart + '/D40', extraparam: southParam, type: 'svg' },
            { key: 'south_akshavedamsa_chart', url: baseChart + '/D45', extraparam: southParam, type: 'svg' },
            { key: 'south_shastiamsa_chart', url: baseChart + '/D60', extraparam: southParam, type: 'svg' },
            { key: 'planets', url: base.replace('/v1', '/v2') + '/planetary-positions', extraparam: [], type: 'data' },
            { key: 'sookshma_dasha', url: base + '/vimshottari-dasha', extraparam: [{ key: 'dasha_type', value: 'sookshma-dasha' }], type: 'data' },
        ];

        const tasks = allTasks.filter(t => kundli[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];

        const results = tasks.length > 0
            ? await Promise.all(tasks.map(async (t) => {
                const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
                const value = t.type === 'svg'
                    ? JSON.stringify({ svg: data?.data?.svg })
                    : JSON.stringify(data?.data);
                return { key: t.key, value };
            }))
            : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }

        const response = { id: kundli_id };
        allTasks.forEach(t => { response[t.key] = safeParse(kundli[t.key]); });
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function findDashaTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('kundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;
        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const mahaUrl = base + '/v1/maha-dasha-analysis';
        const allTasks = [
            { key: 'sun_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'sun' }] },
            { key: 'moon_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'moon' }] },
            { key: 'mars_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'mars' }] },
            { key: 'mercury_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'mercury' }] },
            { key: 'venus_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'venus' }] },
            { key: 'saturn_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'saturn' }] },
            { key: 'jupiter_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'jupiter' }] },
            { key: 'ketu_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'ketu' }] },
            { key: 'rahu_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'rahu' }] },
            { key: 'yogini_dasha', url: base + '/v2/yogini-dasha', extraparam: [] },
            { key: 'south_chalit_chart', url: base + '/v1/horoscope-chart/chalit', extraparam: [{ key: 'chart_type', value: 'south' }] },
            { key: 'birth_chart', url: base + '/v1/horoscope-chart/D1', extraparam: [{ key: 'chart_type', value: 'north' }] },
            { key: 'south_birth_chart', url: base + '/v1/horoscope-chart/D1', extraparam: [{ key: 'chart_type', value: 'south' }] },
            { key: 'sookshma_dasha', url: base + '/v1/vimshottari-dasha', extraparam: [{ key: 'dasha_type', value: 'sookshma-dasha' }] },
        ];
        const tasks = allTasks.filter(t => kundli[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });
        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }
        const response = { id: kundli_id };
        allTasks.forEach(t => { response[t.key] = safeParse(kundli[t.key]); });
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function findReportTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('kundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;
        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const planetUrl = base + '/v2/planet-analysis';
        const mahaUrl = base + '/v1/maha-dasha-analysis';
        const allTasks = [
            { key: 'general_report', url: base + '/v2/ascendant-report', extraparam: [] },
            { key: 'planetary_sun', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'sun' }] },
            { key: 'planetary_moon', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'moon' }] },
            { key: 'planetary_mercury', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'mercury' }] },
            { key: 'planetary_venus', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'venus' }] },
            { key: 'planetary_mars', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'mars' }] },
            { key: 'planetary_jupiter', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'jupiter' }] },
            { key: 'planetary_saturn', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'saturn' }] },
            { key: 'planetary_rahu', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'rahu' }] },
            { key: 'planetary_ketu', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'ketu' }] },
            { key: 'general_yoga_tab', url: base + '/v2/yogas', extraparam: [] },
            { key: 'gemstones', url: base + '/v2/gemstone-suggestion', extraparam: [] },
            { key: 'kalsarpa_dosha', url: base + '/v1/kaal-sarpa-yoga', extraparam: [{ key: 'dasha_type', value: 'sookshma-dasha' }] },
            { key: 'manglik_dosha', url: base + '/v2/manglik-dosha', extraparam: [] },
            { key: 'sadesati_dosha', url: base + '/v2/sadhe-sati', extraparam: [] },
            { key: 'sun_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'sun' }] },
            { key: 'moon_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'moon' }] },
            { key: 'mars_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'mars' }] },
            { key: 'mercury_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'mercury' }] },
            { key: 'venus_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'venus' }] },
            { key: 'saturn_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'saturn' }] },
            { key: 'jupiter_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'jupiter' }] },
            { key: 'ketu_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'ketu' }] },
            { key: 'rahu_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'rahu' }] },
            { key: 'pitra_dosha', url: base + '/v1/pitra-dosha', extraparam: [] },
        ];
        const tasks = allTasks.filter(t => kundli[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });
        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }
        const response = { id: kundli_id };
        allTasks.forEach(t => { response[t.key] = safeParse(kundli[t.key]); });
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getHororscope(req, res) {
    try {
        let { type, rashi, language = 'en' } = req.query;
        if (!type || !rashi) return res.status(400).json({ success: false, message: 'Missing params.' });
        if (type == 'monthly') {
            type = 'month'
        }
        if (type == 'weekly') {
            type = 'week'
        }
        if (type == 'annual') {
            type = 'year'
        }
        let kundli = await db('horoscope')
            .where({ type, rashi, language }).first();
        kundli.data = JSON.parse(kundli.data) || []
        return res.status(200).json({ success: true, data: kundli, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getPersonalHororscope(req, res) {
    try {
        let { type, language = 'en' } = req.query;
        if (!type) return res.status(400).json({ success: false, message: 'Missing params.' });
        if (type == 'monthly') {
            type = 'month'
        }
        if (type == 'weekly') {
            type = 'week'
        }
        if (type == 'annual') {
            type = 'year'
        }
        let kundli = await db('horoscope')
            .where({ type, language });

        kundli.map(item => {
            const data = JSON.parse(item.data) || [];
            item.data = data?.detail?.personal || ""
        })
        return res.status(200).json({ success: true, data: kundli, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function ashtakootMilanApiCall(p1Data, p2Data, language = 'en') {
    const formData = new FormData();

    // Parse Person 1 DOB and birth time
    const p1Lat = p1Data?.lat ?? '22.82';
    const p1Lon = p1Data?.lon ?? '70.84';
    const [p1Year, p1Month, p1Day] = p1Data?.dob.split('-');
    const [p1Hour, p1Min, p1Sec] = p1Data?.birth_time.split(':');

    // Parse Person 2 DOB and birth time
    const p2Lat = p2Data?.lat ?? '22.82';
    const p2Lon = p2Data?.lon ?? '70.84';
    const [p2Year, p2Month, p2Day] = p2Data?.dob.split('-');
    const [p2Hour, p2Min, p2Sec] = p2Data?.birth_time.split(':');

    // Person 1 data
    formData.append('api_key', process.env.KUNDLI_API_KEY);
    formData.append('p1_full_name', p1Data.full_name);
    formData.append('p1_day', p1Day);
    formData.append('p1_month', p1Month);
    formData.append('p1_year', p1Year);
    formData.append('p1_hour', p1Hour);
    formData.append('p1_min', p1Min);
    formData.append('p1_sec', p1Sec || 0);
    formData.append('p1_gender', p1Data.gender);
    formData.append('p1_place', p1Data.place);
    formData.append('p1_lat', p1Lat);
    formData.append('p1_lon', p1Lon);
    formData.append('p1_tzone', p1Data.tzone || '5.5');

    // Person 2 data
    formData.append('p2_full_name', p2Data.full_name);
    formData.append('p2_day', p2Day);
    formData.append('p2_month', p2Month);
    formData.append('p2_year', p2Year);
    formData.append('p2_hour', p2Hour);
    formData.append('p2_min', p2Min);
    formData.append('p2_sec', p2Sec || 0);
    formData.append('p2_gender', p2Data.gender);
    formData.append('p2_place', p2Data.place);
    formData.append('p2_lat', p2Lat);
    formData.append('p2_lon', p2Lon);
    formData.append('p2_tzone', p2Data.tzone || '5.5');

    // Language
    formData.append('lan', language);

    const url = 'https://astroapi-3.divineapi.com/indian-api/v2/ashtakoot-milan';
    const config = {
        method: 'post',
        url,
        headers: {
            Authorization: `Bearer ${process.env.KUNDLI_API_TOKEN}`,
            ...formData.getHeaders(),
        },
        data: formData,
    };

    const response = await axios(config);
    // console.log("ashtakoot milan response", response.data);
    return response?.data;
}

async function ashtakootMilan(req, res) {
    try {
        const {
            // Person 1 details - simplified input
            p1_name, p1_dob, p1_birth_time,
            p1_gender, p1_place, p1_lat, p1_lon, p1_tzone = '5.5',
            // Person 2 details - simplified input
            p2_name, p2_dob, p2_birth_time,
            p2_gender, p2_place, p2_lat, p2_lon, p2_tzone = '5.5',
            // Optional
            language = 'en'
        } = req.body;

        // Validate required fields
        if (!p1_name || !p1_dob || !p1_birth_time || !p1_gender || !p1_place || !p1_lat || !p1_lon) {
            return res.status(400).json({ success: false, message: 'Missing Person 1 required fields (p1_name, p1_dob, p1_birth_time, p1_gender, p1_place, p1_lat, p1_lon).' });
        }

        if (!p2_name || !p2_dob || !p2_birth_time || !p2_gender || !p2_place || !p2_lat || !p2_lon) {
            return res.status(400).json({ success: false, message: 'Missing Person 2 required fields (p2_name, p2_dob, p2_birth_time, p2_gender, p2_place, p2_lat, p2_lon).' });
        }

        // Parse Person 1 DOB and birth time
        const [p1Year, p1Month, p1Day] = p1_dob.split('-');
        const [p1Hour, p1Min, p1Sec] = p1_birth_time.split(':');
        const p1SecInt = parseInt(p1Sec) || 0;

        // Parse Person 2 DOB and birth time
        const [p2Year, p2Month, p2Day] = p2_dob.split('-');
        const [p2Hour, p2Min, p2Sec] = p2_birth_time.split(':');
        const p2SecInt = parseInt(p2Sec) || 0;

        // Optimized query - only select needed columns using composite unique index
        const existingMatch = await db('kundlimatches')
            .select('ashtakoot_milan_data', 'ashtakoot_milan_result', 'manglik_dosha', 'nadi_dosha', 'bhakoot_dosha')
            .where({
                p1_full_name: p1_name,
                p1_day: parseInt(p1Day),
                p1_month: parseInt(p1Month),
                p1_year: parseInt(p1Year),
                p1_hour: parseInt(p1Hour),
                p1_min: parseInt(p1Min),
                p1_sec: p1SecInt,
                p2_full_name: p2_name,
                p2_day: parseInt(p2Day),
                p2_month: parseInt(p2Month),
                p2_year: parseInt(p2Year),
                p2_hour: parseInt(p2Hour),
                p2_min: parseInt(p2Min),
                p2_sec: p2SecInt,
                language
            })
            .first();

        if (existingMatch) {
            // Return existing match
            const response = {
                ashtakoot_milan: existingMatch.ashtakoot_milan_data,
                ashtakoot_milan_result: existingMatch.ashtakoot_milan_result,
                manglik_dosha: existingMatch.manglik_dosha,
                nadi_dosha: existingMatch.nadi_dosha,
                bhakoot_dosha: existingMatch.bhakoot_dosha
            }
            return res.status(200).json({
                success: true, data: response, message: 'Kundli match Successfully'
            });
        }

        // Prepare data for API call
        const p1Data = {
            full_name: p1_name,
            gender: p1_gender,
            dob: p1_dob,
            birth_time: p1_birth_time,
            place: p1_place,
            lat: p1_lat,
            lon: p1_lon,
            tzone: p1_tzone
        };

        const p2Data = {
            full_name: p2_name,
            dob: p2_dob,
            birth_time: p2_birth_time,
            gender: p2_gender,
            place: p2_place,
            lat: p2_lat,
            lon: p2_lon,
            tzone: p2_tzone
        };

        // Call the API
        const apiResponse = await ashtakootMilanApiCall(p1Data, p2Data, language);

        if (!apiResponse || !apiResponse.success) {
            return res.status(400).json({ success: false, message: 'Failed to get matching results from API' });
        }

        // Extract data from API response
        const { ashtakoot_milan, ashtakoot_milan_result, manglik_dosha, nadi_dosha, bhakoot_dosha } = apiResponse.data;

        // Prepare data for database
        const matchData = {
            p1_full_name: p1_name,
            p1_day: parseInt(p1Day),
            p1_month: parseInt(p1Month),
            p1_year: parseInt(p1Year),
            p1_hour: parseInt(p1Hour),
            p1_min: parseInt(p1Min),
            p1_sec: p1SecInt,
            p1_gender,
            p1_place,
            p1_lat: parseFloat(p1_lat),
            p1_lon: parseFloat(p1_lon),
            p1_tzone: parseFloat(p1_tzone),
            p2_full_name: p2_name,
            p2_day: parseInt(p2Day),
            p2_month: parseInt(p2Month),
            p2_year: parseInt(p2Year),
            p2_hour: parseInt(p2Hour),
            p2_min: parseInt(p2Min),
            p2_sec: p2SecInt,
            p2_gender,
            p2_place,
            p2_lat: parseFloat(p2_lat),
            p2_lon: parseFloat(p2_lon),
            p2_tzone: parseFloat(p2_tzone),
            ashtakoot_milan_data: ashtakoot_milan,
            ashtakoot_milan_result: ashtakoot_milan_result,
            manglik_dosha: manglik_dosha,
            nadi_dosha: nadi_dosha === 'true' || nadi_dosha === true,
            bhakoot_dosha: bhakoot_dosha === 'true' || bhakoot_dosha === true,
            points_obtained: ashtakoot_milan_result?.points_obtained || 0,
            max_points: ashtakoot_milan_result?.max_ponits || 36,
            is_compatible: ashtakoot_milan_result?.is_compatible === 'true' || ashtakoot_milan_result?.is_compatible === true,
            language
        };

        // Save to database
        const [savedMatch] = await db('kundlimatches')
            .insert(matchData)
            .returning('*');

        // Return response in the same format as the API
        const response = {
            ashtakoot_milan: savedMatch.ashtakoot_milan_data,
            ashtakoot_milan_result: savedMatch.ashtakoot_milan_result,
            manglik_dosha: savedMatch.manglik_dosha,
            nadi_dosha: savedMatch.nadi_dosha,
            bhakoot_dosha: savedMatch.bhakoot_dosha
        };
        return res.status(200).json({ success: true, data: response, message: 'Get matching success' });
    } catch (err) {
        console.error('Ashtakoot Milan Error:', err);
        res.status(500).json({ success: false, message: 'Server error', error: err.message });
    }
}

async function getFreeBasicKundli(req, res) {
    try {
        let { profile_id, name, dob, type, birth_time, gender, birth_place, lat = '22.82', lng = '70.84', language = 'en' } = req.query;

        // console.log("req.query", req.query);
        if (!type) return res.status(400).json({ success: false, message: 'Missing params.' });

        const authHeader = req.headers.authorization;
        // console.log("authHeader", authHeader);
        const url = 'https://astroapi-3.divineapi.com/indian-api/v3/basic-astro-details'
        if (type == 'profile' && !authHeader?.startsWith('Bearer ')) {
            return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        if (authHeader && type == 'profile' && authHeader.startsWith('Bearer ')) {
            // console.log("authHeader", authHeader);
            const tokenData = decodeJWT(authHeader)
            if (!tokenData?.success || !tokenData?.data?.userId) return res.status(400).json({ success: false, message: 'Your session expired.' });
            const user = await db('userprofiles')
                .where({ 'id': Number(profile_id), user_id: tokenData?.data?.userId })
                .first();
            if (!user) return res.status(400).json({ success: false, message: 'Your session expired.' });
            const date = new Date(user?.dob).toISOString().slice(0, 10);

            name = user?.name
            gender = user?.gender
            birth_time = user?.birth_time
            dob = date
            birth_place = user?.birth_place
            lat = user?.lat || lat
            lng = user?.lng || lng

            let kundli = await db('basickundlis')
                .where({ profile_id, language }).select('dob', 'birth_time', 'name', 'gender', 'birth_place', 'basic', 'ghata_chakra', 'id')
                .first();

            if (user?.is_updated || !kundli) {
                const [response, ghataChakra] = await Promise.all([
                    basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url),
                    basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, 'https://astroapi-3.divineapi.com/indian-api/v1/ghata-chakra')
                ]);
                kundli = { ...kundli, name, gender, dob, birth_place, birth_time, lng, lat, language, profile_id: Number(profile_id) }
                kundli.basic = JSON.stringify(response?.data)
                kundli.ghata_chakra = JSON.stringify(ghataChakra?.data)

                // console.log("kundli", kundli);
                if (kundli.id) {
                    await db('basickundlis')
                        .where({ id: kundli.id }).update(kundli)
                } else {
                    const [saved] = await db('basickundlis')
                        .insert(kundli).returning("*");
                    kundli.id = saved.id
                }
                await db('userprofiles').where({ 'id': Number(profile_id) }).update({ is_updated: false })
            }
            kundli.basic = JSON.parse(kundli.basic)
            kundli.ghata_chakra = JSON.parse(kundli?.ghata_chakra)

            return res.status(200).json({ success: true, data: kundli, message: 'Kundli get Successfully' });
        }
        let user = await db('basickundlis')
            .where({ name, gender, dob, birth_place, birth_time, language })
            .select('dob', 'birth_time', 'name', 'gender', 'birth_place', 'basic', 'ghata_chakra', 'language', 'id')
            .first();

        if (!user) {
            const [response, ghataChakra] = await Promise.all([
                basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url),
                basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, 'https://astroapi-3.divineapi.com/indian-api/v1/ghata-chakra')
            ]);
            user = { name, gender, dob, birth_place, birth_time, lat, lng, language }
            if (profile_id) {
                user.profile_id = profile_id
            }
            user.basic = JSON.stringify(response?.data)
            user.ghata_chakra = JSON.stringify(ghataChakra?.data)
            const [saved] = await db('basickundlis').insert(user).returning("*");
            // await db('follows').insert({ user_id: req?.userId, pandit_id: panditId, type: "user" });
            user.id = saved.id
        }
        // console.log("user", user);
        user.basic = JSON.parse(user.basic)
        user.ghata_chakra = JSON.parse(user.ghata_chakra)
        return res.status(200).json({ success: true, data: user, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreekpTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        const kundli = await db('basickundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const kpkundli = await db('kpkundlis')
            .where({ kundli_id })
            .first();
        const chalit_chart_detail = await db('chalit_chart')
            .where({ kundli_id })
            .first();
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli

        const params = {
            chalit_chart: chalit_chart_detail?.chalit_chart,
            ruling_planet: kpkundli?.ruling_planet,
            kp_planet: kpkundli?.kp_planet,
            kp_cusps: kpkundli?.kp_cusps
        }
        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const allTasks = [
            { key: 'chalit_chart', url: base + '/v1/horoscope-chart/chalit', extraparam: [] },
            { key: 'ruling_planet', url: base + '/v2/kp/planetary-positions', extraparam: [] },
            { key: 'kp_planet', url: base + '/v2/kp/planetary-positions', extraparam: [] },
            { key: 'kp_cusps', url: base + '/v2/kp/cuspal', extraparam: [] },
        ];
        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });
        if (Object.keys(upd).length > 0) {
            if (upd.chalit_chart != null) {
                await db('chalit_chart')
                    .where({ kundli_id })
                    .update({ chalit_chart: upd.chalit_chart });
            }
            const kpUpd = { ...upd };
            delete kpUpd.chalit_chart;
            if (Object.keys(kpUpd).length > 0) {
                await db('kpkundlis')
                    .where({ kundli_id })
                    .update(kpUpd);
            }
        }

        // Response: chalit_chart -> chalit_chart table; ruling_planet, kp_planet, kp_cusps -> kpkundlis
        const chalitFinal = upd.chalit_chart ?? chalit_chart_detail?.chalit_chart;
        const rulingFinal = upd.ruling_planet ?? kpkundli?.ruling_planet;
        const kpPlanetFinal = upd.kp_planet ?? kpkundli?.kp_planet;
        const kpCuspsFinal = upd.kp_cusps ?? kpkundli?.kp_cusps;
        const response = {
            id: kundli_id,
            chalit_chart: safeParse(chalitFinal),
            ruling_planet: safeParse(rulingFinal),
            kp_planet: safeParse(kpPlanetFinal),
            kp_cusps: safeParse(kpCuspsFinal),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeAshtakvargaTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, birth_time, language, name, gender, birth_place } = kundli
        const ashtakvargaDetail = await db('ashtakvargakundlis')
            .where({ kundli_id })
            .first();
        let ashtakvarga = ashtakvargaDetail?.ashtakvarga || null
        const upd = {}
        if (ashtakvarga == null) {
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/bhinnashtakvarga/ashtakvarga'
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl)
            upd.ashtakvarga = JSON.stringify(chalitChartresponse?.data?.chart);
            ashtakvarga = upd.ashtakvarga
        }
        if (Object.keys(upd).length > 0) {
            await db('ashtakvargakundlis')
                .where({ kundli_id })
                .update(upd)
        }
        const response = {
            id: kundli_id,
            ashtakvarga: JSON.parse(ashtakvarga),
        }
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeDashaTab(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        const kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });

        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let dashakundli = await db('dashakundlis').where({ kundli_id }).first();
        let sookshmaRow = await db('sookshma_dasha').where({ kundli_id }).first();

        const params = {
            sun_dasha: dashakundli?.sun_dasha,
            moon_dasha: dashakundli?.moon_dasha,
            mars_dasha: dashakundli?.mars_dasha,
            mercury_dasha: dashakundli?.mercury_dasha,
            venus_dasha: dashakundli?.venus_dasha,
            saturn_dasha: dashakundli?.saturn_dasha,
            ketu_dasha: dashakundli?.ketu_dasha,
            rahu_dasha: dashakundli?.rahu_dasha,
            jupiter_dasha: dashakundli?.jupiter_dasha,
            yogini_dasha: dashakundli?.yogini_dasha,
            sookshma_dasha: sookshmaRow?.sookshma_dasha,
        };

        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const mahaUrl = base + '/v1/maha-dasha-analysis';
        const allTasks = [
            { key: 'sun_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'sun' }] },
            { key: 'moon_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'moon' }] },
            { key: 'mars_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'mars' }] },
            { key: 'mercury_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'mercury' }] },
            { key: 'venus_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'venus' }] },
            { key: 'saturn_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'saturn' }] },
            { key: 'jupiter_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'jupiter' }] },
            { key: 'ketu_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'ketu' }] },
            { key: 'rahu_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'rahu' }] },
            { key: 'yogini_dasha', url: base + '/v2/yogini-dasha', extraparam: [] },
            { key: 'sookshma_dasha', url: base + '/v1/vimshottari-dasha', extraparam: [{ key: 'dasha_type', value: 'sookshma-dasha' }] },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            const dashaKeys = ['sun_dasha', 'moon_dasha', 'mars_dasha', 'mercury_dasha', 'venus_dasha', 'saturn_dasha', 'ketu_dasha', 'rahu_dasha', 'jupiter_dasha', 'yogini_dasha'];
            const dashaUpd = {};
            dashaKeys.forEach(k => { if (upd[k] != null) dashaUpd[k] = upd[k]; });
            if (Object.keys(dashaUpd).length > 0) {
                if (dashakundli) {
                    await db('dashakundlis').where({ kundli_id }).update(dashaUpd);
                } else {
                    await db('dashakundlis').insert({ kundli_id, ...dashaUpd });
                }
            }
            if (upd.sookshma_dasha != null) {
                if (sookshmaRow) {
                    await db('sookshma_dasha').where({ kundli_id }).update({ sookshma_dasha: upd.sookshma_dasha });
                } else {
                    await db('sookshma_dasha').insert({ kundli_id, sookshma_dasha: upd.sookshma_dasha });
                }
            }
        }

        dashakundli = await db('dashakundlis').where({ kundli_id }).first();
        sookshmaRow = await db('sookshma_dasha').where({ kundli_id }).first();

        const response = {
            id: kundli_id,
            sun_dasha: safeParse(upd.sun_dasha ?? dashakundli?.sun_dasha),
            moon_dasha: safeParse(upd.moon_dasha ?? dashakundli?.moon_dasha),
            mars_dasha: safeParse(upd.mars_dasha ?? dashakundli?.mars_dasha),
            mercury_dasha: safeParse(upd.mercury_dasha ?? dashakundli?.mercury_dasha),
            venus_dasha: safeParse(upd.venus_dasha ?? dashakundli?.venus_dasha),
            saturn_dasha: safeParse(upd.saturn_dasha ?? dashakundli?.saturn_dasha),
            ketu_dasha: safeParse(upd.ketu_dasha ?? dashakundli?.ketu_dasha),
            rahu_dasha: safeParse(upd.rahu_dasha ?? dashakundli?.rahu_dasha),
            jupiter_dasha: safeParse(upd.jupiter_dasha ?? dashakundli?.jupiter_dasha),
            yogini_dasha: safeParse(upd.yogini_dasha ?? dashakundli?.yogini_dasha),
            sookshma_dasha: safeParse(upd.sookshma_dasha ?? sookshmaRow?.sookshma_dasha),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getGeneralReport(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        const kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let reportRow = await db('reportkundlis').where({ kundli_id }).first();
        let dashakundli = await db('dashakundlis').where({ kundli_id }).first();

        // Only params used in response – fewer API calls
        const params = {
            general_report: reportRow?.general_report,
            general_yoga_tab: reportRow?.general_yoga_tab,
            planetary_sun: reportRow?.planetary_sun,
            planetary_moon: reportRow?.planetary_moon,
            planetary_mercury: reportRow?.planetary_mercury,
            planetary_venus: reportRow?.planetary_venus,
            planetary_mars: reportRow?.planetary_mars,
            planetary_jupiter: reportRow?.planetary_jupiter,
            planetary_saturn: reportRow?.planetary_saturn,
            planetary_rahu: reportRow?.planetary_rahu,
            planetary_ketu: reportRow?.planetary_ketu,
            sun_dasha: dashakundli?.sun_dasha,
            moon_dasha: dashakundli?.moon_dasha,
            mars_dasha: dashakundli?.mars_dasha,
            mercury_dasha: dashakundli?.mercury_dasha,
            venus_dasha: dashakundli?.venus_dasha,
            saturn_dasha: dashakundli?.saturn_dasha,
            jupiter_dasha: dashakundli?.jupiter_dasha,
            ketu_dasha: dashakundli?.ketu_dasha,
            rahu_dasha: dashakundli?.rahu_dasha,
        };

        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const planetUrl = base + '/v2/planet-analysis';
        const mahaUrl = base + '/v1/maha-dasha-analysis';
        const allTasks = [
            { key: 'general_report', url: base + '/v2/ascendant-report', extraparam: [] },
            { key: 'planetary_sun', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'sun' }] },
            { key: 'planetary_moon', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'moon' }] },
            { key: 'planetary_mercury', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'mercury' }] },
            { key: 'planetary_venus', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'venus' }] },
            { key: 'planetary_mars', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'mars' }] },
            { key: 'planetary_jupiter', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'jupiter' }] },
            { key: 'planetary_saturn', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'saturn' }] },
            { key: 'planetary_rahu', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'rahu' }] },
            { key: 'planetary_ketu', url: planetUrl, extraparam: [{ key: 'analysis_planet', value: 'ketu' }] },
            { key: 'general_yoga_tab', url: base + '/v2/yogas', extraparam: [] },
            { key: 'sun_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'sun' }] },
            { key: 'moon_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'moon' }] },
            { key: 'mars_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'mars' }] },
            { key: 'mercury_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'mercury' }] },
            { key: 'venus_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'venus' }] },
            { key: 'saturn_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'saturn' }] },
            { key: 'jupiter_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'jupiter' }] },
            { key: 'ketu_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'ketu' }] },
            { key: 'rahu_dasha', url: mahaUrl, extraparam: [{ key: 'maha_dasha', value: 'rahu' }] },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            const reportKeys = ['general_report', 'general_yoga_tab', 'planetary_sun', 'planetary_moon', 'planetary_mercury', 'planetary_venus', 'planetary_mars', 'planetary_jupiter', 'planetary_saturn', 'planetary_rahu', 'planetary_ketu'];
            const reportUpd = {};
            reportKeys.forEach(k => { if (upd[k] != null) reportUpd[k] = upd[k]; });
            if (Object.keys(reportUpd).length > 0) {
                if (reportRow) {
                    await db('reportkundlis').where({ kundli_id }).update(reportUpd);
                } else {
                    await db('reportkundlis').insert({ kundli_id, ...reportUpd });
                }
            }
            const dashaKeys = ['sun_dasha', 'moon_dasha', 'mars_dasha', 'mercury_dasha', 'venus_dasha', 'saturn_dasha', 'jupiter_dasha', 'ketu_dasha', 'rahu_dasha'];
            const dashaUpd = {};
            dashaKeys.forEach(k => { if (upd[k] != null) dashaUpd[k] = upd[k]; });
            if (Object.keys(dashaUpd).length > 0) {
                if (dashakundli) {
                    await db('dashakundlis').where({ kundli_id }).update(dashaUpd);
                } else {
                    await db('dashakundlis').insert({ kundli_id, ...dashaUpd });
                }
            }
        }

        reportRow = await db('reportkundlis').where({ kundli_id }).first();
        dashakundli = await db('dashakundlis').where({ kundli_id }).first();

        const response = {
            id: kundli_id,
            general_report: safeParse(upd.general_report ?? reportRow?.general_report),
            general_yoga_tab: safeParse(upd.general_yoga_tab ?? reportRow?.general_yoga_tab),
            planetary_sun: safeParse(upd.planetary_sun ?? reportRow?.planetary_sun),
            planetary_moon: safeParse(upd.planetary_moon ?? reportRow?.planetary_moon),
            planetary_mercury: safeParse(upd.planetary_mercury ?? reportRow?.planetary_mercury),
            planetary_venus: safeParse(upd.planetary_venus ?? reportRow?.planetary_venus),
            planetary_mars: safeParse(upd.planetary_mars ?? reportRow?.planetary_mars),
            planetary_jupiter: safeParse(upd.planetary_jupiter ?? reportRow?.planetary_jupiter),
            planetary_saturn: safeParse(upd.planetary_saturn ?? reportRow?.planetary_saturn),
            planetary_rahu: safeParse(upd.planetary_rahu ?? reportRow?.planetary_rahu),
            planetary_ketu: safeParse(upd.planetary_ketu ?? reportRow?.planetary_ketu),
            sun_dasha: safeParse(upd.sun_dasha ?? dashakundli?.sun_dasha),
            moon_dasha: safeParse(upd.moon_dasha ?? dashakundli?.moon_dasha),
            mars_dasha: safeParse(upd.mars_dasha ?? dashakundli?.mars_dasha),
            mercury_dasha: safeParse(upd.mercury_dasha ?? dashakundli?.mercury_dasha),
            venus_dasha: safeParse(upd.venus_dasha ?? dashakundli?.venus_dasha),
            saturn_dasha: safeParse(upd.saturn_dasha ?? dashakundli?.saturn_dasha),
            jupiter_dasha: safeParse(upd.jupiter_dasha ?? dashakundli?.jupiter_dasha),
            ketu_dasha: safeParse(upd.ketu_dasha ?? dashakundli?.ketu_dasha),
            rahu_dasha: safeParse(upd.rahu_dasha ?? dashakundli?.rahu_dasha),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getRemedieReport(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        const kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let reportRow = await db('reportkundlis').where({ kundli_id }).first();

        // Response only uses general_report, gemstones – only these API calls
        const params = { general_report: reportRow?.general_report, gemstones: reportRow?.gemstones };
        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const allTasks = [
            { key: 'general_report', url: base + '/v2/ascendant-report', extraparam: [] },
            { key: 'gemstones', url: base + '/v2/gemstone-suggestion', extraparam: [] },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            const reportKeys = ['general_report', 'gemstones'];
            const reportUpd = {};
            reportKeys.forEach(k => { if (upd[k] != null) reportUpd[k] = upd[k]; });
            if (Object.keys(reportUpd).length > 0) {
                if (reportRow) {
                    await db('reportkundlis').where({ kundli_id }).update(reportUpd);
                } else {
                    await db('reportkundlis').insert({ kundli_id, ...reportUpd });
                }
            }
        }

        reportRow = await db('reportkundlis').where({ kundli_id }).first();

        const response = {
            id: kundli_id,
            general_report: safeParse(upd.general_report ?? reportRow?.general_report),
            gemstones: safeParse(upd.gemstones ?? reportRow?.gemstones),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getDoshaReport(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        const kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let reportRow = await db('reportkundlis').where({ kundli_id }).first();

        // Response: general_report + doshas only – only these API calls
        const params = {
            general_report: reportRow?.general_report,
            pitra_dosha: reportRow?.pitra_dosha,
            kalsarpa_dosha: reportRow?.kalsarpa_dosha,
            manglik_dosha: reportRow?.manglik_dosha,
            sadesati_dosha: reportRow?.sadesati_dosha,
        };
        const base = 'https://astroapi-3.divineapi.com/indian-api';
        const allTasks = [
            { key: 'general_report', url: base + '/v2/ascendant-report', extraparam: [] },
            { key: 'pitra_dosha', url: base + '/v1/pitra-dosha', extraparam: [] },
            { key: 'kalsarpa_dosha', url: base + '/v1/kaal-sarpa-yoga', extraparam: [{ key: 'dasha_type', value: 'sookshma-dasha' }] },
            { key: 'manglik_dosha', url: base + '/v2/manglik-dosha', extraparam: [] },
            { key: 'sadesati_dosha', url: base + '/v2/sadhe-sati', extraparam: [] },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            return { key: t.key, value: JSON.stringify(data?.data) };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            const reportKeys = ['general_report', 'pitra_dosha', 'kalsarpa_dosha', 'manglik_dosha', 'sadesati_dosha'];
            const reportUpd = {};
            reportKeys.forEach(k => { if (upd[k] != null) reportUpd[k] = upd[k]; });
            if (Object.keys(reportUpd).length > 0) {
                if (reportRow) {
                    await db('reportkundlis').where({ kundli_id }).update(reportUpd);
                } else {
                    await db('reportkundlis').insert({ kundli_id, ...reportUpd });
                }
            }
        }

        reportRow = await db('reportkundlis').where({ kundli_id }).first();

        const response = {
            id: kundli_id,
            general_report: safeParse(upd.general_report ?? reportRow?.general_report),
            pitra_dosha: safeParse(upd.pitra_dosha ?? reportRow?.pitra_dosha),
            kalsarpa_dosha: safeParse(upd.kalsarpa_dosha ?? reportRow?.kalsarpa_dosha),
            manglik_dosha: safeParse(upd.manglik_dosha ?? reportRow?.manglik_dosha),
            sadesati_dosha: safeParse(upd.sadesati_dosha ?? reportRow?.sadesati_dosha),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeLagnaChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const validation = validateKundliParams(kundli);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let reportRow = await db('lagna_chart').where({ kundli_id }).first();

        // Response: general_report + doshas only – only these API calls
        const params = {
            birth_chart: reportRow?.birth_chart,
        };
        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const baseChart = base + '/horoscope-chart';
        const northParam = [{ key: 'chart_type', value: 'north' }];

        const allTasks = [
            { key: 'birth_chart', url: baseChart + '/D1', extraparam: northParam, type: 'svg' },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];

        const results = tasks.length > 0
            ? await Promise.all(tasks.map(async (t) => {
                const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
                const value = t.type === 'svg'
                    ? JSON.stringify({ svg: data?.data?.svg })
                    : JSON.stringify(data?.data);
                return { key: t.key, value };
            }))
            : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            if (upd.birth_chart != null) {
                if (reportRow) await db('lagna_chart').where({ kundli_id }).update({ birth_chart: upd.birth_chart });
                else await db('lagna_chart').insert({ kundli_id, birth_chart: upd.birth_chart });
            }
        }

        const response = {
            id: kundli_id,
            birth_chart: safeParse(upd.birth_chart ?? reportRow?.birth_chart),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeNavamsaChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const validation = validateKundliParams(kundli);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let navamsaRow = await db('navamsa_chart').where({ kundli_id }).first();
        const params = {
            navamsa_chart: navamsaRow?.navamsa_chart,
        };

        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const northParam = [{ key: 'chart_type', value: 'north' }];
        const allTasks = [
            { key: 'navamsa_chart', url: base + '/horoscope-chart/D9', extraparam: northParam, type: 'svg' },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            const value = t.type === 'svg' ? JSON.stringify({ svg: data?.data?.svg }) : JSON.stringify(data?.data);
            return { key: t.key, value };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            if (upd.navamsa_chart != null) {
                if (navamsaRow) await db('navamsa_chart').where({ kundli_id }).update({ navamsa_chart: upd.navamsa_chart });
                else await db('navamsa_chart').insert({ kundli_id, navamsa_chart: upd.navamsa_chart });
            }
        }

        const response = {
            id: kundli_id,
            navamsa_chart: safeParse(upd.navamsa_chart ?? navamsaRow?.navamsa_chart),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeTransitChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const validation = validateKundliParams(kundli);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let transitRow = await db('transit_chart').where({ kundli_id }).first();
        const params = {
            transit_ascendant: transitRow?.transit_ascendant,
            transit_moon: transitRow?.transit_moon,
        };

        const [year, month, day] = dob.split('-');
        const transitNorth = [
            { key: 'transit_year', value: year },
            { key: 'transit_month', value: month },
            { key: 'transit_day', value: day },
            { key: 'chart_type', value: 'north' }
        ];
        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const allTasks = [
            { key: 'transit_ascendant', url: base + '/kundli-transit/ascendant', extraparam: transitNorth, type: 'svg' },
            { key: 'transit_moon', url: base + '/kundli-transit/moon', extraparam: transitNorth, type: 'svg' },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            const value = t.type === 'svg' ? JSON.stringify({ svg: data?.data?.svg }) : JSON.stringify(data?.data);
            return { key: t.key, value };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            if (upd.transit_ascendant != null || upd.transit_moon != null) {
                const transitUpd = {};
                if (upd.transit_ascendant != null) transitUpd.transit_ascendant = upd.transit_ascendant;
                if (upd.transit_moon != null) transitUpd.transit_moon = upd.transit_moon;
                if (transitRow) await db('transit_chart').where({ kundli_id }).update(transitUpd);
                else await db('transit_chart').insert({ kundli_id, ...transitUpd });
            }
        }

        const response = {
            id: kundli_id,
            transit_ascendant: safeParse(upd.transit_ascendant ?? transitRow?.transit_ascendant),
            transit_moon: safeParse(upd.transit_moon ?? transitRow?.transit_moon),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeDivisionalChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const validation = validateKundliParams(kundli);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        const [divisonalRow] = await Promise.all([
            db('divisonal_chart').where({ kundli_id }).first(),
        ]);
        const params = {
            sun_chart: divisonalRow?.sun_chart,
            moon_chart: divisonalRow?.moon_chart,
            hora_chart: divisonalRow?.hora_chart,
            drekkana_chart: divisonalRow?.drekkana_chart,
            chaturthamsha_chart: divisonalRow?.chaturthamsha_chart,
            saptamsa_chart: divisonalRow?.saptamsa_chart,
            dasamsa_chart: divisonalRow?.dasamsa_chart,
            dwadasamsa_chart: divisonalRow?.dwadasamsa_chart,
            shodasamsa_chart: divisonalRow?.shodasamsa_chart,
            vimsamsa_chart: divisonalRow?.vimsamsa_chart,
            chaturvimsamsa_chart: divisonalRow?.chaturvimsamsa_chart,
            saptavimsamsa_chart: divisonalRow?.saptavimsamsa_chart,
            trimsamsa_chart: divisonalRow?.trimsamsa_chart,
            khavedamsa_chart: divisonalRow?.khavedamsa_chart,
            akshavedamsa_chart: divisonalRow?.akshavedamsa_chart,
            shastiamsa_chart: divisonalRow?.shastiamsa_chart,
        };

        const [year, month, day] = dob.split('-');
        const transitNorth = [
            { key: 'transit_year', value: year },
            { key: 'transit_month', value: month },
            { key: 'transit_day', value: day },
            { key: 'chart_type', value: 'north' }
        ];
        const northParam = [{ key: 'chart_type', value: 'north' }];
        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const baseChart = base + '/horoscope-chart';

        const allTasks = [
            { key: 'sun_chart', url: baseChart + '/SUN', extraparam: northParam, type: 'svg' },
            { key: 'moon_chart', url: baseChart + '/MOON', extraparam: northParam, type: 'svg' },
            { key: 'birth_chart', url: baseChart + '/D1', extraparam: northParam, type: 'svg' },
            { key: 'hora_chart', url: baseChart + '/D2', extraparam: northParam, type: 'svg' },
            { key: 'drekkana_chart', url: baseChart + '/D3', extraparam: northParam, type: 'svg' },
            { key: 'chaturthamsha_chart', url: baseChart + '/D4', extraparam: northParam, type: 'svg' },
            { key: 'saptamsa_chart', url: baseChart + '/D7', extraparam: northParam, type: 'svg' },
            { key: 'navamsa_chart', url: baseChart + '/D9', extraparam: northParam, type: 'svg' },
            { key: 'dasamsa_chart', url: baseChart + '/D10', extraparam: northParam, type: 'svg' },
            { key: 'dwadasamsa_chart', url: baseChart + '/D12', extraparam: northParam, type: 'svg' },
            { key: 'shodasamsa_chart', url: baseChart + '/D16', extraparam: northParam, type: 'svg' },
            { key: 'vimsamsa_chart', url: baseChart + '/D20', extraparam: northParam, type: 'svg' },
            { key: 'chaturvimsamsa_chart', url: baseChart + '/D24', extraparam: northParam, type: 'svg' },
            { key: 'saptavimsamsa_chart', url: baseChart + '/D27', extraparam: northParam, type: 'svg' },
            { key: 'trimsamsa_chart', url: baseChart + '/D30', extraparam: northParam, type: 'svg' },
            { key: 'khavedamsa_chart', url: baseChart + '/D40', extraparam: northParam, type: 'svg' },
            { key: 'akshavedamsa_chart', url: baseChart + '/D45', extraparam: northParam, type: 'svg' },
            { key: 'shastiamsa_chart', url: baseChart + '/D60', extraparam: northParam, type: 'svg' },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            const value = t.type === 'svg' ? JSON.stringify({ svg: data?.data?.svg }) : JSON.stringify(data?.data);
            return { key: t.key, value };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            const divKeys = ['sun_chart', 'moon_chart', 'hora_chart', 'drekkana_chart', 'chaturthamsha_chart', 'saptamsa_chart', 'dasamsa_chart', 'dwadasamsa_chart', 'shodasamsa_chart', 'vimsamsa_chart', 'chaturvimsamsa_chart', 'saptavimsamsa_chart', 'trimsamsa_chart', 'khavedamsa_chart', 'akshavedamsa_chart', 'shastiamsa_chart'];
            const divUpd = {};
            divKeys.forEach(k => { if (upd[k] != null) divUpd[k] = upd[k]; });
            if (Object.keys(divUpd).length > 0) {
                if (divisonalRow) await db('divisonal_chart').where({ kundli_id }).update(divUpd);
                else await db('divisonal_chart').insert({ kundli_id, ...divUpd });
            }
        }

        const response = {
            id: kundli_id,
            sun_chart: safeParse(upd.sun_chart ?? divisonalRow?.sun_chart),
            moon_chart: safeParse(upd.moon_chart ?? divisonalRow?.moon_chart),
            hora_chart: safeParse(upd.hora_chart ?? divisonalRow?.hora_chart),
            drekkana_chart: safeParse(upd.drekkana_chart ?? divisonalRow?.drekkana_chart),
            chaturthamsha_chart: safeParse(upd.chaturthamsha_chart ?? divisonalRow?.chaturthamsha_chart),
            saptamsa_chart: safeParse(upd.saptamsa_chart ?? divisonalRow?.saptamsa_chart),
            dasamsa_chart: safeParse(upd.dasamsa_chart ?? divisonalRow?.dasamsa_chart),
            dwadasamsa_chart: safeParse(upd.dwadasamsa_chart ?? divisonalRow?.dwadasamsa_chart),
            shodasamsa_chart: safeParse(upd.shodasamsa_chart ?? divisonalRow?.shodasamsa_chart),
            vimsamsa_chart: safeParse(upd.vimsamsa_chart ?? divisonalRow?.vimsamsa_chart),
            chaturvimsamsa_chart: safeParse(upd.chaturvimsamsa_chart ?? divisonalRow?.chaturvimsamsa_chart),
            saptavimsamsa_chart: safeParse(upd.saptavimsamsa_chart ?? divisonalRow?.saptavimsamsa_chart),
            trimsamsa_chart: safeParse(upd.trimsamsa_chart ?? divisonalRow?.trimsamsa_chart),
            khavedamsa_chart: safeParse(upd.khavedamsa_chart ?? divisonalRow?.khavedamsa_chart),
            akshavedamsa_chart: safeParse(upd.akshavedamsa_chart ?? divisonalRow?.akshavedamsa_chart),
            shastiamsa_chart: safeParse(upd.shastiamsa_chart ?? divisonalRow?.shastiamsa_chart),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeSouthLagnaChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const validation = validateKundliParams(kundli);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let lagnaRow = await db('lagna_chart').where({ kundli_id }).first();
        const params = {
            south_birth_chart: lagnaRow?.south_birth_chart,
        };

        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const southParam = [{ key: 'chart_type', value: 'south' }];
        const allTasks = [
            { key: 'south_birth_chart', url: base + '/horoscope-chart/D1', extraparam: southParam, type: 'svg' },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            const value = t.type === 'svg' ? JSON.stringify({ svg: data?.data?.svg }) : JSON.stringify(data?.data);
            return { key: t.key, value };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            if (upd.south_birth_chart != null) {
                if (lagnaRow) await db('lagna_chart').where({ kundli_id }).update({ south_birth_chart: upd.south_birth_chart });
                else await db('lagna_chart').insert({ kundli_id, south_birth_chart: upd.south_birth_chart });
            }
        }

        const response = {
            id: kundli_id,
            south_birth_chart: safeParse(upd.south_birth_chart ?? lagnaRow?.south_birth_chart),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeSouthNavamsaChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const validation = validateKundliParams(kundli);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let navamsaRow = await db('navamsa_chart').where({ kundli_id }).first();
        const params = {
            south_navamsa_chart: navamsaRow?.south_navamsa_chart,
        };

        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const southParam = [{ key: 'chart_type', value: 'south' }];
        const allTasks = [
            { key: 'south_navamsa_chart', url: base + '/horoscope-chart/D9', extraparam: southParam, type: 'svg' },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            const value = t.type === 'svg' ? JSON.stringify({ svg: data?.data?.svg }) : JSON.stringify(data?.data);
            return { key: t.key, value };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            if (upd.south_navamsa_chart != null) {
                if (navamsaRow) await db('navamsa_chart').where({ kundli_id }).update({ south_navamsa_chart: upd.south_navamsa_chart });
                else await db('navamsa_chart').insert({ kundli_id, south_navamsa_chart: upd.south_navamsa_chart });
            }
        }

        const response = {
            id: kundli_id,
            south_navamsa_chart: safeParse(upd.south_navamsa_chart ?? navamsaRow?.south_navamsa_chart),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeSouthTransitChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const validation = validateKundliParams(kundli);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        let transitRow = await db('transit_chart').where({ kundli_id }).first();
        const params = {
            south_transit_ascendant: transitRow?.south_transit_ascendant,
            south_transit_moon: transitRow?.south_transit_moon,
        };

        const [year, month, day] = dob.split('-');
        const transitSouth = [
            { key: 'transit_year', value: year },
            { key: 'transit_month', value: month },
            { key: 'transit_day', value: day },
            { key: 'chart_type', value: 'south' }
        ];
        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const allTasks = [
            { key: 'south_transit_ascendant', url: base + '/kundli-transit/ascendant', extraparam: transitSouth, type: 'svg' },
            { key: 'south_transit_moon', url: base + '/kundli-transit/moon', extraparam: transitSouth, type: 'svg' },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            const value = t.type === 'svg' ? JSON.stringify({ svg: data?.data?.svg }) : JSON.stringify(data?.data);
            return { key: t.key, value };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            if (upd.south_transit_ascendant != null || upd.south_transit_moon != null) {
                const tUpd = {};
                if (upd.south_transit_ascendant != null) tUpd.south_transit_ascendant = upd.south_transit_ascendant;
                if (upd.south_transit_moon != null) tUpd.south_transit_moon = upd.south_transit_moon;
                if (transitRow) await db('transit_chart').where({ kundli_id }).update(tUpd);
                else await db('transit_chart').insert({ kundli_id, ...tUpd });
            }
        }

        const response = {
            id: kundli_id,
            south_transit_ascendant: safeParse(upd.south_transit_ascendant ?? transitRow?.south_transit_ascendant),
            south_transit_moon: safeParse(upd.south_transit_moon ?? transitRow?.south_transit_moon),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeSouthDivisionalChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis').where({ id: kundli_id }).first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const validation = validateKundliParams(kundli);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });
        const { lat, lng, dob, language, birth_time, name, gender, birth_place } = kundli;

        const [divisonalRow] = await Promise.all([
            db('divisonal_chart').where({ kundli_id }).first(),
        ]);
        const params = {

            south_sun_chart: divisonalRow?.south_sun_chart,
            south_moon_chart: divisonalRow?.south_moon_chart,
            south_hora_chart: divisonalRow?.south_hora_chart,
            south_drekkana_chart: divisonalRow?.south_drekkana_chart,
            south_chaturthamsha_chart: divisonalRow?.south_chaturthamsha_chart,
            south_saptamsa_chart: divisonalRow?.south_saptamsa_chart,
            south_dasamsa_chart: divisonalRow?.south_dasamsa_chart,
            south_dwadasamsa_chart: divisonalRow?.south_dwadasamsa_chart,
            south_shodasamsa_chart: divisonalRow?.south_shodasamsa_chart,
            south_vimsamsa_chart: divisonalRow?.south_vimsamsa_chart,
            south_chaturvimsamsa_chart: divisonalRow?.south_chaturvimsamsa_chart,
            south_saptavimsamsa_chart: divisonalRow?.south_saptavimsamsa_chart,
            south_trimsamsa_chart: divisonalRow?.south_trimsamsa_chart,
            south_khavedamsa_chart: divisonalRow?.south_khavedamsa_chart,
            south_akshavedamsa_chart: divisonalRow?.south_akshavedamsa_chart,
            south_shastiamsa_chart: divisonalRow?.south_shastiamsa_chart,
        };

        const [year, month, day] = dob.split('-');
        const transitSouth = [
            { key: 'transit_year', value: year },
            { key: 'transit_month', value: month },
            { key: 'transit_day', value: day },
            { key: 'chart_type', value: 'south' }
        ];
        const southParam = [{ key: 'chart_type', value: 'south' }];
        const base = 'https://astroapi-3.divineapi.com/indian-api/v1';
        const baseChart = base + '/horoscope-chart';

        const allTasks = [
            { key: 'south_sun_chart', url: baseChart + '/SUN', extraparam: southParam, type: 'svg' },
            { key: 'south_moon_chart', url: baseChart + '/MOON', extraparam: southParam, type: 'svg' },
            { key: 'south_birth_chart', url: baseChart + '/D1', extraparam: southParam, type: 'svg' },
            { key: 'south_hora_chart', url: baseChart + '/D2', extraparam: southParam, type: 'svg' },
            { key: 'south_drekkana_chart', url: baseChart + '/D3', extraparam: southParam, type: 'svg' },
            { key: 'south_chaturthamsha_chart', url: baseChart + '/D4', extraparam: southParam, type: 'svg' },
            { key: 'south_saptamsa_chart', url: baseChart + '/D7', extraparam: southParam, type: 'svg' },
            { key: 'south_navamsa_chart', url: baseChart + '/D9', extraparam: southParam, type: 'svg' },
            { key: 'south_dasamsa_chart', url: baseChart + '/D10', extraparam: southParam, type: 'svg' },
            { key: 'south_dwadasamsa_chart', url: baseChart + '/D12', extraparam: southParam, type: 'svg' },
            { key: 'south_shodasamsa_chart', url: baseChart + '/D16', extraparam: southParam, type: 'svg' },
            { key: 'south_vimsamsa_chart', url: baseChart + '/D20', extraparam: southParam, type: 'svg' },
            { key: 'south_chaturvimsamsa_chart', url: baseChart + '/D24', extraparam: southParam, type: 'svg' },
            { key: 'south_saptavimsamsa_chart', url: baseChart + '/D27', extraparam: southParam, type: 'svg' },
            { key: 'south_trimsamsa_chart', url: baseChart + '/D30', extraparam: southParam, type: 'svg' },
            { key: 'south_khavedamsa_chart', url: baseChart + '/D40', extraparam: southParam, type: 'svg' },
            { key: 'south_akshavedamsa_chart', url: baseChart + '/D45', extraparam: southParam, type: 'svg' },
            { key: 'south_shastiamsa_chart', url: baseChart + '/D60', extraparam: southParam, type: 'svg' },
        ];

        const tasks = allTasks.filter(t => params[t.key] == null);
        const apiArgs = [language, lat, lng, dob, birth_time, name, gender, birth_place];
        const results = tasks.length > 0 ? await Promise.all(tasks.map(async (t) => {
            const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
            const value = t.type === 'svg' ? JSON.stringify({ svg: data?.data?.svg }) : JSON.stringify(data?.data);
            return { key: t.key, value };
        })) : [];
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            const divSouthKeys = ['south_sun_chart', 'south_moon_chart', 'south_hora_chart', 'south_drekkana_chart', 'south_chaturthamsha_chart', 'south_saptamsa_chart', 'south_dasamsa_chart', 'south_dwadasamsa_chart', 'south_shodasamsa_chart', 'south_vimsamsa_chart', 'south_chaturvimsamsa_chart', 'south_saptavimsamsa_chart', 'south_trimsamsa_chart', 'south_khavedamsa_chart', 'south_akshavedamsa_chart', 'south_shastiamsa_chart'];
            const divUpd = {};
            divSouthKeys.forEach(k => { if (upd[k] != null) divUpd[k] = upd[k]; });
            if (Object.keys(divUpd).length > 0) {
                if (divisonalRow) await db('divisonal_chart').where({ kundli_id }).update(divUpd);
                else await db('divisonal_chart').insert({ kundli_id, ...divUpd });
            }
        }

        const response = {
            id: kundli_id,
            south_sun_chart: safeParse(upd.south_sun_chart ?? divisonalRow?.south_sun_chart),
            south_moon_chart: safeParse(upd.south_moon_chart ?? divisonalRow?.south_moon_chart),
            south_hora_chart: safeParse(upd.south_hora_chart ?? divisonalRow?.south_hora_chart),
            south_drekkana_chart: safeParse(upd.south_drekkana_chart ?? divisonalRow?.south_drekkana_chart),
            south_chaturthamsha_chart: safeParse(upd.south_chaturthamsha_chart ?? divisonalRow?.south_chaturthamsha_chart),
            south_saptamsa_chart: safeParse(upd.south_saptamsa_chart ?? divisonalRow?.south_saptamsa_chart),
            south_dasamsa_chart: safeParse(upd.south_dasamsa_chart ?? divisonalRow?.south_dasamsa_chart),
            south_dwadasamsa_chart: safeParse(upd.south_dwadasamsa_chart ?? divisonalRow?.south_dwadasamsa_chart),
            south_shodasamsa_chart: safeParse(upd.south_shodasamsa_chart ?? divisonalRow?.south_shodasamsa_chart),
            south_vimsamsa_chart: safeParse(upd.south_vimsamsa_chart ?? divisonalRow?.south_vimsamsa_chart),
            south_chaturvimsamsa_chart: safeParse(upd.south_chaturvimsamsa_chart ?? divisonalRow?.south_chaturvimsamsa_chart),
            south_saptavimsamsa_chart: safeParse(upd.south_saptavimsamsa_chart ?? divisonalRow?.south_saptavimsamsa_chart),
            south_trimsamsa_chart: safeParse(upd.south_trimsamsa_chart ?? divisonalRow?.south_trimsamsa_chart),
            south_khavedamsa_chart: safeParse(upd.south_khavedamsa_chart ?? divisonalRow?.south_khavedamsa_chart),
            south_akshavedamsa_chart: safeParse(upd.south_akshavedamsa_chart ?? divisonalRow?.south_akshavedamsa_chart),
            south_shastiamsa_chart: safeParse(upd.south_shastiamsa_chart ?? divisonalRow?.south_shastiamsa_chart),
        };
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreePlanetsChart(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, birth_time, language, name, gender, birth_place } = kundli
        const ashtakvargaDetail = await db('planetkundlis')
            .where({ kundli_id })
            .first();
        let planets = ashtakvargaDetail?.planets || null
        const upd = {}
        if (planets == null) {
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v2/planetary-positions'
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl)
            upd.planets = JSON.stringify(chalitChartresponse?.data);
            planets = upd.planets
        }
        if (Object.keys(upd).length > 0) {
            await db('planetkundlis')
                .where({ kundli_id })
                .update(upd)
        }
        const response = {
            id: kundli_id,
            planets: JSON.parse(planets),
        }
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getFreeSookshmaDasha(req, res) {
    try {
        const { kundli_id } = req.query;
        if (!kundli_id) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('basickundlis')
            .where({ id: kundli_id })
            .first();
        if (!kundli) return res.status(400).json({ success: false, message: 'Kundli not found.' });
        const { lat, lng, dob, birth_time, language, name, gender, birth_place } = kundli
        let sookshmaDashaRow = await db('sookshma_dasha').where({ kundli_id }).first();

        let sookshma_dasha = sookshmaDashaRow?.sookshma_dasha || null
        const upd = {}
        if (sookshma_dasha == null) {
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/vimshottari-dasha'
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: 'dasha_type', value: 'sookshma-dasha' }])
            upd.sookshma_dasha = JSON.stringify(chalitChartresponse?.data);
            sookshma_dasha = upd.sookshma_dasha
        }
        if (Object.keys(upd).length > 0) {
            await db('sookshma_dasha')
                .where({ kundli_id })
                .update(upd)
        }
        const response = {
            id: kundli_id,
            sookshma_dasha: JSON.parse(sookshma_dasha),
        }
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendCall(req, res) {
    try {
        const { from, to } = req.body
        const numbers = ["1413232575", "1413231101", "1413232574", "1413231093"]
        const did = numbers[Math.floor(Math.random() * numbers.length)];

        const response = await axios({
            method: 'post',
            url: "https://voicecallconnect.com/ctc/external/create-call",
            headers: { Authorization: "Bearer 669B2JB1EKFF9aa0jUpwMvk4cel6ie47TyF3ZZJSxgjHGvKkHsbm9k6c9GQ0g669" },
            data: {
                source: from,
                destination: to,
                // did: "+911413231099",//["+911413231091", "+911413231099"]
                did
            }
        });
        console.log("response,response", response?.data);
        res.status(200).json({ success: true, message: "test" });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}
module.exports = { findBasicKundli, findkundliTab, findkpTab, findAshtakvargaTab, findChartTab, findDashaTab, findReportTab, getHororscope, getPersonalHororscope, ashtakootMilan, getFreeBasicKundli, getFreekpTab, getFreeAshtakvargaTab, getFreeDashaTab, getGeneralReport, getRemedieReport, getDoshaReport, getFreeLagnaChart, getFreeNavamsaChart, getFreeTransitChart, getFreeDivisionalChart, getFreeSouthDivisionalChart, getFreeSouthTransitChart, getFreeSouthNavamsaChart, getFreeSouthLagnaChart, getFreePlanetsChart, getFreeSookshmaDasha, sendCall };