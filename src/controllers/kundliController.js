const db = require('../db');
require('dotenv').config();
const { decodeJWT } = require('../utils/decodeJWT');
const axios = require('axios');
const FormData = require('form-data');

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

        const response = {
            id: kundli_id,
            birth_chart: JSON.parse(kundli.birth_chart),
            navamsa_chart: JSON.parse(kundli.navamsa_chart),
            south_birth_chart: JSON.parse(kundli.south_birth_chart),
            south_navamsa_chart: JSON.parse(kundli.south_navamsa_chart),
            planets: JSON.parse(kundli.planets),
            sookshma_dasha: JSON.parse(kundli.sookshma_dasha),
        }
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
        const { lat, lng, dob, language, birth_time, name, gender, birth_place, chalit_chart, ruling_planet, kp_planet, kp_cusps } = kundli
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
        const response = {
            id: kundli_id,
            chalit_chart: JSON.parse(kundli.chalit_chart),
            ruling_planet: JSON.parse(kundli.ruling_planet),
            kp_planet: JSON.parse(kundli.kp_planet),
            kp_cusps: JSON.parse(kundli.kp_cusps),
        }
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
        const { lat, lng, dob, language, birth_time, name, gender, birth_place, chalit_chart, south_chalit_chart, sun_chart, south_sun_chart, moon_chart, south_moon_chart, birth_chart, south_birth_chart,
            hora_chart, south_hora_chart, drekkana_chart, south_drekkana_chart, chaturthamsha_chart, south_chaturthamsha_chart, saptamsa_chart, south_saptamsa_chart, navamsa_chart, south_navamsa_chart,
            dasamsa_chart, south_dasamsa_chart, dwadasamsa_chart, south_dwadasamsa_chart, shodasamsa_chart, south_shodasamsa_chart, vimsamsa_chart, south_vimsamsa_chart, chaturvimsamsa_chart, south_chaturvimsamsa_chart, south_transit_ascendant, south_transit_moon, transit_ascendant, transit_moon,
            saptavimsamsa_chart, south_saptavimsamsa_chart, trimsamsa_chart, south_trimsamsa_chart, khavedamsa_chart, south_khavedamsa_chart, akshavedamsa_chart, south_akshavedamsa_chart, shastiamsa_chart, south_shastiamsa_chart, planets, sookshma_dasha } = kundli;

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

        console.log("api call start ", new Date());
        const results = tasks.length > 0
            ? await Promise.all(tasks.map(async (t) => {
                const data = await basicKundliApiCall(...apiArgs, t.url, t.extraparam);
                const value = t.type === 'svg'
                    ? JSON.stringify({ svg: data?.data?.svg })
                    : JSON.stringify(data?.data);
                return { key: t.key, value };
            }))
            : [];
        console.log("api call end ", new Date());
        const upd = {};
        results.forEach(r => { upd[r.key] = r.value; });

        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }

        const response = {
            id: kundli_id,
            chalit_chart: JSON.parse(kundli.chalit_chart),
            birth_chart: JSON.parse(kundli.birth_chart),
            navamsa_chart: JSON.parse(kundli.navamsa_chart),

            sun_chart: JSON.parse(kundli.sun_chart),
            moon_chart: JSON.parse(kundli.moon_chart),
            hora_chart: JSON.parse(kundli.hora_chart),
            drekkana_chart: JSON.parse(kundli.drekkana_chart),
            chaturthamsha_chart: JSON.parse(kundli.chaturthamsha_chart),
            saptamsa_chart: JSON.parse(kundli.saptamsa_chart),
            dasamsa_chart: JSON.parse(kundli.dasamsa_chart),
            dwadasamsa_chart: JSON.parse(kundli.dwadasamsa_chart),
            shodasamsa_chart: JSON.parse(kundli.shodasamsa_chart),
            vimsamsa_chart: JSON.parse(kundli.vimsamsa_chart),
            chaturvimsamsa_chart: JSON.parse(kundli.chaturvimsamsa_chart),
            saptavimsamsa_chart: JSON.parse(kundli.saptavimsamsa_chart),
            trimsamsa_chart: JSON.parse(kundli.trimsamsa_chart),
            khavedamsa_chart: JSON.parse(kundli.khavedamsa_chart),
            akshavedamsa_chart: JSON.parse(kundli.akshavedamsa_chart),
            shastiamsa_chart: JSON.parse(kundli.shastiamsa_chart),

            south_chalit_chart: JSON.parse(kundli.south_chalit_chart),
            south_birth_chart: JSON.parse(kundli.south_birth_chart),
            south_navamsa_chart: JSON.parse(kundli.south_navamsa_chart),

            south_sun_chart: JSON.parse(kundli.south_sun_chart),
            south_moon_chart: JSON.parse(kundli.south_moon_chart),
            south_hora_chart: JSON.parse(kundli.south_hora_chart),
            south_drekkana_chart: JSON.parse(kundli.south_drekkana_chart),
            south_chaturthamsha_chart: JSON.parse(kundli.south_chaturthamsha_chart),
            south_saptamsa_chart: JSON.parse(kundli.south_saptamsa_chart),
            south_dasamsa_chart: JSON.parse(kundli.south_dasamsa_chart),
            south_dwadasamsa_chart: JSON.parse(kundli.south_dwadasamsa_chart),
            south_shodasamsa_chart: JSON.parse(kundli.south_shodasamsa_chart),
            south_vimsamsa_chart: JSON.parse(kundli.south_vimsamsa_chart),
            south_chaturvimsamsa_chart: JSON.parse(kundli.south_chaturvimsamsa_chart),
            south_saptavimsamsa_chart: JSON.parse(kundli.south_saptavimsamsa_chart),
            south_trimsamsa_chart: JSON.parse(kundli.south_trimsamsa_chart),
            south_khavedamsa_chart: JSON.parse(kundli.south_khavedamsa_chart),
            south_akshavedamsa_chart: JSON.parse(kundli.south_akshavedamsa_chart),
            south_shastiamsa_chart: JSON.parse(kundli.south_shastiamsa_chart),

            planets: JSON.parse(kundli.planets),
            south_transit_ascendant: JSON.parse(kundli.south_transit_ascendant),
            south_transit_moon: JSON.parse(kundli.south_transit_moon),
            transit_ascendant: JSON.parse(kundli.transit_ascendant),
            transit_moon: JSON.parse(kundli.transit_moon),
            sookshma_dasha: JSON.parse(kundli.sookshma_dasha),
        }
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
        const { lat, lng, dob, language, birth_time, name, gender, birth_place, sun_dasha, south_chalit_chart, moon_dasha, mars_dasha, mercury_dasha, venus_dasha, saturn_dasha, jupiter_dasha, ketu_dasha, rahu_dasha, yogini_dasha, birth_chart, south_birth_chart, sookshma_dasha } = kundli
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
        const response = {
            id: kundli_id,
            sun_dasha: JSON.parse(kundli.sun_dasha),
            moon_dasha: JSON.parse(kundli.moon_dasha),
            mars_dasha: JSON.parse(kundli.mars_dasha),
            mercury_dasha: JSON.parse(kundli.mercury_dasha),
            venus_dasha: JSON.parse(kundli.venus_dasha),
            saturn_dasha: JSON.parse(kundli.saturn_dasha),
            ketu_dasha: JSON.parse(kundli.ketu_dasha),
            rahu_dasha: JSON.parse(kundli.rahu_dasha),
            jupiter_dasha: JSON.parse(kundli.jupiter_dasha),
            south_chalit_chart: JSON.parse(kundli.south_chalit_chart),
            yogini_dasha: JSON.parse(kundli.yogini_dasha),
            birth_chart: JSON.parse(kundli.birth_chart),
            south_birth_chart: JSON.parse(kundli.south_birth_chart),
            sookshma_dasha: JSON.parse(kundli.sookshma_dasha)
        }
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
        const { lat, lng, dob, language, birth_time, name, gender, birth_place, general_report, kalsarpa_dosha, manglik_dosha, sadesati_dosha, general_yoga_tab,
            gemstones, planetary_sun, planetary_moon, planetary_mercury, planetary_venus, planetary_mars, planetary_jupiter, planetary_saturn, planetary_rahu, planetary_ketu,
            sun_dasha, moon_dasha, mars_dasha, mercury_dasha, venus_dasha, saturn_dasha, jupiter_dasha, ketu_dasha, rahu_dasha, pitra_dosha
        } = kundli
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
        const response = {
            id: kundli_id,
            general_report: JSON.parse(kundli.general_report),
            kalsarpa_dosha: JSON.parse(kundli.kalsarpa_dosha),
            manglik_dosha: JSON.parse(kundli.manglik_dosha),
            sadesati_dosha: JSON.parse(kundli.sadesati_dosha),
            general_yoga_tab: JSON.parse(kundli.general_yoga_tab),
            gemstones: JSON.parse(kundli.gemstones),
            planetary_sun: JSON.parse(kundli.planetary_sun),
            planetary_moon: JSON.parse(kundli.planetary_moon),
            planetary_mercury: JSON.parse(kundli.planetary_mercury),
            planetary_venus: JSON.parse(kundli.planetary_venus),
            planetary_mars: JSON.parse(kundli.planetary_mars),
            planetary_jupiter: JSON.parse(kundli.planetary_jupiter),
            planetary_saturn: JSON.parse(kundli.planetary_saturn),
            planetary_rahu: JSON.parse(kundli.planetary_rahu),
            planetary_ketu: JSON.parse(kundli.planetary_ketu),
            sun_dasha: JSON.parse(kundli.sun_dasha),
            moon_dasha: JSON.parse(kundli.moon_dasha),
            mars_dasha: JSON.parse(kundli.mars_dasha),
            mercury_dasha: JSON.parse(kundli.mercury_dasha),
            venus_dasha: JSON.parse(kundli.venus_dasha),
            saturn_dasha: JSON.parse(kundli.saturn_dasha),
            jupiter_dasha: JSON.parse(kundli.jupiter_dasha),
            ketu_dasha: JSON.parse(kundli.ketu_dasha),
            rahu_dasha: JSON.parse(kundli.rahu_dasha),
            pitra_dosha: JSON.parse(kundli.pitra_dosha),
        }
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

module.exports = { findBasicKundli, findkundliTab, findkpTab, findAshtakvargaTab, findChartTab, findDashaTab, findReportTab, getHororscope, getPersonalHororscope, ashtakootMilan };