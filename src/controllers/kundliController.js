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
            if (!tokenData?.success) return res.status(400).json({ success: false, message: 'Your session expired.' });
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
                // console.log("dob, birth_time, name, gender, birth_place, url", dob, birth_time, name, gender, birth_place, url);
                const response = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url)
                const ghataChakra = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, 'https://astroapi-3.divineapi.com/indian-api/v1/ghata-chakra',)
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
            // console.log("inside api");
            const response = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url)
            // console.log(response.data);
            const ghataChakra = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, 'https://astroapi-3.divineapi.com/indian-api/v1/ghata-chakra',)

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
        const upd = {}
        if (birth_chart == null) {
            console.log("here");
            const birthChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D1'
            const birthChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, birthChartUrl, [{ key: "chart_type", value: "north" }])
            upd.birth_chart = JSON.stringify(birthChartresponse?.data);
        }
        if (navamsa_chart == null) {
            const Navamsha = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D9'
            const Navamsharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Navamsha, [{ key: "chart_type", value: "north" }])
            upd.navamsa_chart = JSON.stringify(Navamsharesponse?.data);
        }

        if (south_birth_chart == null) {
            const birthChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D1'
            const birthChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, birthChartUrl, [{ key: "chart_type", value: "south" }])
            upd.south_birth_chart = JSON.stringify(birthChartresponse?.data);
        }
        if (south_navamsa_chart == null) {
            const Navamsha = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D9'
            const Navamsharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Navamsha, [{ key: "chart_type", value: "south" }])
            upd.south_navamsa_chart = JSON.stringify(Navamsharesponse?.data);
        }

        if (planets == null) {
            const Planets = 'https://astroapi-3.divineapi.com/indian-api/v2/planetary-positions'
            const Planetsresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Planets)
            upd.planets = JSON.stringify(Planetsresponse?.data);
        }
        const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v1/vimshottari-dasha'
        if (sookshma_dasha == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Vimshottari, [{ key: "dasha_type", value: "sookshma-dasha" }])
            upd.sookshma_dasha = JSON.stringify(sookshmadasharesponse?.data);
        }

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
        const upd = {}
        if (chalit_chart == null) {
            console.log("here");
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/chalit'
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl)
            upd.chalit_chart = JSON.stringify(chalitChartresponse?.data);
        }
        if (ruling_planet == null) {
            const Navamsha = 'https://astroapi-3.divineapi.com/indian-api/v2/kp/planetary-positions'
            const Navamsharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Navamsha)
            upd.ruling_planet = JSON.stringify(Navamsharesponse?.data);
        }
        if (kp_planet == null) {
            const Planets = 'https://astroapi-3.divineapi.com/indian-api/v2/kp/planetary-positions'
            const Planetsresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Planets)
            upd.kp_planet = JSON.stringify(Planetsresponse?.data);
        }
        // const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v1/vimshottari-dasha'
        if (kp_cusps == null) {
            const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v2/kp/cuspal'
            const mahaDasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Vimshottari)
            upd.kp_cusps = JSON.stringify(mahaDasharesponse?.data);
        }

        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }

        const response = {
            id: kundli_id,
            chalit_chart: JSON.parse(kundli.chalit_chart),
            ruling_planet: JSON.parse(kundli.chalit_chart),
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
            dasamsa_chart, south_dasamsa_chart, dwadasamsa_chart, south_dwadasamsa_chart, shodasamsa_chart, south_shodasamsa_chart, vimsamsa_chart, south_vimsamsa_chart, chaturvimsamsa_chart, south_chaturvimsamsa_chart,
            saptavimsamsa_chart, south_saptavimsamsa_chart, trimsamsa_chart, south_trimsamsa_chart, khavedamsa_chart, south_khavedamsa_chart, akshavedamsa_chart, south_akshavedamsa_chart, shastiamsa_chart, south_shastiamsa_chart } = kundli
        const upd = {}
        let extraparam = [{ key: "chart_type", value: "north" }]
        if (chalit_chart == null) {
            console.log("here");
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/chalit'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.chalit_chart = JSON.stringify(data?.data);
        }
        if (sun_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/SUN'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.sun_chart = JSON.stringify(data?.data);
        }
        if (moon_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/MOON'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.moon_chart = JSON.stringify(data?.data);
        }
        if (birth_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D1'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.birth_chart = JSON.stringify(data?.data);
        }
        if (hora_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D2'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.hora_chart = JSON.stringify(data?.data);
        }
        if (drekkana_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D3'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.drekkana_chart = JSON.stringify(data?.data);
        }
        if (chaturthamsha_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D4'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.chaturthamsha_chart = JSON.stringify(data?.data);
        }
        if (saptamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D7'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.saptamsa_chart = JSON.stringify(data?.data);
        }
        if (navamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D9'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.navamsa_chart = JSON.stringify(data?.data);
        }
        if (dasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D10'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.dasamsa_chart = JSON.stringify(data?.data);
        }
        if (dwadasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D12'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.dwadasamsa_chart = JSON.stringify(data?.data);
        }
        if (shodasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D16'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.shodasamsa_chart = JSON.stringify(data?.data);
        }
        if (vimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D20'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.vimsamsa_chart = JSON.stringify(data?.data);
        }
        if (chaturvimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D24'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.chaturvimsamsa_chart = JSON.stringify(data?.data);
        }
        if (saptavimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D27'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.saptavimsamsa_chart = JSON.stringify(data?.data);
        }
        if (trimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D30'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.trimsamsa_chart = JSON.stringify(data?.data);
        }
        if (khavedamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D40'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.khavedamsa_chart = JSON.stringify(data?.data);
        }
        if (akshavedamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D45'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.akshavedamsa_chart = JSON.stringify(data?.data);
        }
        if (shastiamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D60'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.shastiamsa_chart = JSON.stringify(data?.data);
        }
        extraparam = [{ key: "chart_type", value: "south" }]

        if (south_chalit_chart == null) {
            console.log("here");
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/chalit'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_chalit_chart = JSON.stringify(data?.data);
        }
        if (south_sun_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/SUN'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_sun_chart = JSON.stringify(data?.data);
        }
        if (south_moon_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/MOON'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_moon_chart = JSON.stringify(data?.data);
        }
        if (south_birth_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D1'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_birth_chart = JSON.stringify(data?.data);
        }
        if (south_hora_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D2'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_hora_chart = JSON.stringify(data?.data);
        }
        if (south_drekkana_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D3'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_drekkana_chart = JSON.stringify(data?.data);
        }
        if (south_chaturthamsha_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D4'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_chaturthamsha_chart = JSON.stringify(data?.data);
        }
        if (south_saptamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D7'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_saptamsa_chart = JSON.stringify(data?.data);
        }
        if (south_navamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D9'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_navamsa_chart = JSON.stringify(data?.data);
        }
        if (south_dasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D10'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_dasamsa_chart = JSON.stringify(data?.data);
        }
        if (south_dwadasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D12'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_dwadasamsa_chart = JSON.stringify(data?.data);
        }
        if (south_shodasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D16'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_shodasamsa_chart = JSON.stringify(data?.data);
        }
        if (south_vimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D20'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_vimsamsa_chart = JSON.stringify(data?.data);
        }
        if (south_chaturvimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D24'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_chaturvimsamsa_chart = JSON.stringify(data?.data);
        }
        if (south_saptavimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D27'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_saptavimsamsa_chart = JSON.stringify(data?.data);
        }
        if (south_trimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D30'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_trimsamsa_chart = JSON.stringify(data?.data);
        }
        if (south_khavedamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D40'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_khavedamsa_chart = JSON.stringify(data?.data);
        }
        if (south_akshavedamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D45'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_akshavedamsa_chart = JSON.stringify(data?.data);
        }
        if (south_shastiamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D60'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, extraparam)
            upd.south_shastiamsa_chart = JSON.stringify(data?.data);
        }

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
        const { lat, lng, dob, language, birth_time, name, gender, birth_place, sun_dasha, south_chalit_chart, moon_dasha, mars_dasha, mercury_dasha, venus_dasha, saturn_dasha, jupiter_dasha, ketu_dasha, rahu_dasha, yogini_dasha, birth_chart, south_birth_chart } = kundli
        const upd = {}
        const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/maha-dasha-analysis'
        if (sun_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "sun" }])
            upd.sun_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (moon_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "moon" }])
            upd.moon_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (mars_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "mars" }])
            upd.mars_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (mercury_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "mercury" }])
            upd.mercury_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (venus_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "venus" }])
            upd.venus_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (saturn_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "saturn" }])
            upd.saturn_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (jupiter_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "jupiter" }])
            upd.jupiter_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (ketu_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "ketu" }])
            upd.ketu_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (rahu_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "rahu" }])
            upd.rahu_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (yogini_dasha == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v2/yogini-dasha'
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url)
            upd.yogini_dasha = JSON.stringify(chalitChartresponse?.data);
        }

        if (south_chalit_chart == null) {
            console.log("here");
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/chalit'
            const data = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url, [{ key: "chart_type", value: "south" }])
            upd.south_chalit_chart = JSON.stringify(data?.data);
        }

        if (birth_chart == null) {
            const birthChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D1'
            const birthChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, birthChartUrl, [{ key: "chart_type", value: "north" }])
            upd.birth_chart = JSON.stringify(birthChartresponse?.data);
        }

        if (south_birth_chart == null) {
            const birthChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D1'
            const birthChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, birthChartUrl, [{ key: "chart_type", value: "south" }])
            upd.south_birth_chart = JSON.stringify(birthChartresponse?.data);
        }

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
            south_birth_chart: JSON.parse(kundli.south_birth_chart)
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
            sun_dasha, moon_dasha, mars_dasha, mercury_dasha, venus_dasha, saturn_dasha, jupiter_dasha, ketu_dasha, rahu_dasha
        } = kundli
        const upd = {}
        if (general_report == null) {
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v2/ascendant-report'
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl)
            upd.general_report = JSON.stringify(chalitChartresponse?.data);
        }
        const planetUrl = 'https://astroapi-3.divineapi.com/indian-api/v2/planet-analysis'
        if (planetary_sun == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "sun" }])
            upd.planetary_sun = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (planetary_moon == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "moon" }])
            upd.planetary_moon = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (planetary_mercury == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "mercury" }])
            upd.planetary_mercury = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (planetary_venus == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "venus" }])
            upd.planetary_venus = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (planetary_mars == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "mars" }])
            upd.planetary_mars = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (planetary_jupiter == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "jupiter" }])
            upd.planetary_jupiter = JSON.stringify(sookshmadasharesponse?.data);
        }
        if (planetary_saturn == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "saturn" }])
            upd.planetary_saturn = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (planetary_rahu == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "rahu" }])
            upd.planetary_rahu = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (planetary_ketu == null) {
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, planetUrl, [{ key: "analysis_planet", value: "ketu" }])
            upd.planetary_ketu = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (general_yoga_tab == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v2/yogas'
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url)
            upd.general_yoga_tab = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (gemstones == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v2/gemstone-suggestion'
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, url)
            upd.gemstones = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (kalsarpa_dosha == null) {
            const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v1/kaal-sarpa-yoga'
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Vimshottari, [{ key: "dasha_type", value: "sookshma-dasha" }])
            upd.kalsarpa_dosha = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (manglik_dosha == null) {
            const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v2/manglik-dosha'
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Vimshottari)
            upd.manglik_dosha = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (sadesati_dosha == null) {
            const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v2/sadhe-sati'
            const sookshmadasharesponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, Vimshottari)
            upd.sadesati_dosha = JSON.stringify(sookshmadasharesponse?.data);
        }

        const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/maha-dasha-analysis'
        if (sun_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "sun" }])
            upd.sun_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (moon_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "moon" }])
            upd.moon_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (mars_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "mars" }])
            upd.mars_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (mercury_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "mercury" }])
            upd.mercury_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (venus_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "venus" }])
            upd.venus_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (saturn_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "saturn" }])
            upd.saturn_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (jupiter_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "jupiter" }])
            upd.jupiter_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (ketu_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "ketu" }])
            upd.ketu_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (rahu_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(language, lat, lng, dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "rahu" }])
            upd.rahu_dasha = JSON.stringify(chalitChartresponse?.data);
        }

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