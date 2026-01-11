const db = require('../db');
require('dotenv').config();
const { decodeJWT } = require('../utils/decodeJWT');
const axios = require('axios');
const FormData = require('form-data');

async function basicKundliApiCall(dob, birth_time, name, gender, birth_place, url, extraparam = []) {

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
    formData.append('lat', '22.82');
    formData.append('lon', '70.84');
    formData.append('tzone', '5.5');
    formData.append('lan', 'en');

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
    console.log("response", response.data);
    return response?.data
}

async function horoscopeApiCall(url, extraparam = []) {
    const formData = new FormData();
    formData.append('api_key', process.env.KUNDLI_API_KEY);
    formData.append('sign', sign);
    formData.append('tzone', '5.5');
    formData.append('lan', 'en');

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
    return response?.data
}

async function findBasicKundli(req, res) {
    try {
        let { profile_id, name, dob, type, birth_time, gender, birth_place } = req.query;
        if (!type) return res.status(400).json({ success: false, message: 'Missing params.' });

        const authHeader = req.headers.authorization;
        const url = 'https://astroapi-3.divineapi.com/indian-api/v3/basic-astro-details'
        if (type == 'profile' && (!authHeader.startsWith('Bearer ')) || !authHeader) {
            return res.status(400).json({ success: false, message: 'Missing params.' });
        }
        if (authHeader && type == 'profile' && authHeader.startsWith('Bearer ')) {
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

            let kundli = await db('kundlis')
                .where({ profile_id }).select('dob', 'birth_time', 'name', 'gender', 'birth_place', 'basic', 'id')
                .first();

            if (user?.is_updated || !kundli) {
                console.log("dob, birth_time, name, gender, birth_place, url", dob, birth_time, name, gender, birth_place, url);
                const response = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
                kundli = { ...kundli, name, gender, dob, birth_place, birth_time, profile_id: Number(profile_id) }
                kundli.basic = JSON.stringify(response?.data)
                console.log("kundli", kundli);
                if (kundli.id) {
                    await db('kundlis')
                        .where({ id: kundli.id }).update(kundli)
                } else {
                    await db('kundlis')
                        .insert(kundli)
                }
                await db('userprofiles').where({ 'id': Number(profile_id) }).update({ is_updated: false })
            }
            kundli.basic = JSON.parse(kundli.basic)
            return res.status(200).json({ success: true, data: kundli, message: 'Kundli get Successfully' });
        }
        let user = await db('kundlis')
            .where({ name, gender, dob, birth_place, birth_time })
            .select('dob', 'birth_time', 'name', 'gender', 'birth_place', 'basic', 'id')
            .first();

        if (!user) {
            console.log("inside api");
            const response = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            console.log(response.data);

            user = { name, gender, dob, birth_place, birth_time }
            if (profile_id) {
                user.profile_id = profile_id
            }
            user.basic = JSON.stringify(response?.data)
            await db('kundlis').insert(user);
            // await db('follows').insert({ user_id: req?.userId, pandit_id: panditId, type: "user" });
        }
        user.basic = JSON.parse(user.basic)
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
        const { dob, birth_time, name, gender, birth_place, birth_chart, navamsa_chart, planets, sookshma_dasha } = kundli
        const upd = {}
        if (birth_chart == null) {
            console.log("here");
            const birthChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D1'
            const birthChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, birthChartUrl)
            upd.birth_chart = JSON.stringify(birthChartresponse?.data);
        }
        if (navamsa_chart == null) {
            const Navamsha = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D9'
            const Navamsharesponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Navamsha)
            upd.navamsa_chart = JSON.stringify(Navamsharesponse?.data);
        }
        if (planets == null) {
            const Planets = 'https://astroapi-3.divineapi.com/indian-api/v2/planetary-positions'
            const Planetsresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Planets)
            upd.planets = JSON.stringify(Planetsresponse?.data);
        }
        const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v1/vimshottari-dasha'
        if (sookshma_dasha == null) {
            const sookshmadasharesponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Vimshottari, [{ key: "dasha_type", value: "sookshma-dasha" }])
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
        const { dob, birth_time, name, gender, birth_place, chalit_chart, ruling_planet, kp_planet, kp_cusps } = kundli
        const upd = {}
        if (chalit_chart == null) {
            console.log("here");
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/chalit'
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl)
            upd.chalit_chart = JSON.stringify(chalitChartresponse?.data);
        }
        // if (ruling_planet == null) {
        //     const Navamsha = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D9'
        //     const Navamsharesponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Navamsha)
        //     upd.ruling_planet = JSON.stringify(Navamsharesponse?.data);
        // }
        if (kp_planet == null) {
            const Planets = 'https://astroapi-3.divineapi.com/indian-api/v2/sub-planet-positions'
            const Planetsresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Planets)
            upd.kp_planet = JSON.stringify(Planetsresponse?.data);
        }
        // const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v1/vimshottari-dasha'
        // if (kp_cusps == null) {
        //     const mahaDasharesponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Vimshottari, [{ key: "dasha_type", value: "maha-dasha" }])
        //     upd.kp_cusps = JSON.stringify(mahaDasharesponse?.data);
        // }

        if (Object.keys(upd).length > 0) {
            [kundli] = await db('kundlis')
                .where('id', kundli?.id)
                .update(upd)
                .returning('*');
        }

        const response = {
            id: kundli_id,
            chalit_chart: JSON.parse(kundli.chalit_chart),
            ruling_planet,
            kp_planet,
            kp_cusps
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
        const { dob, birth_time, name, gender, birth_place, ashtakvarga } = kundli
        const upd = {}
        if (ashtakvarga == null) {
            console.log("here");
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/bhinnashtakvarga/ashtakvarga'
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl)
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
        const { dob, birth_time, name, gender, birth_place, chalit_chart, sun_chart, moon_chart, birth_chart, hora_chart, drekkana_chart, chaturthamsha_chart, saptamsa_chart, navamsa_chart, dasamsa_chart, dwadasamsa_chart, shodasamsa_chart, vimsamsa_chart, chaturvimsamsa_chart, saptavimsamsa_chart, trimsamsa_chart, khavedamsa_chart, akshavedamsa_chart, shastiamsa_chart } = kundli
        const upd = {}
        if (chalit_chart == null) {
            console.log("here");
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/chalit'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.chalit_chart = JSON.stringify(data?.data);
        }
        if (sun_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/SUN'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.sun_chart = JSON.stringify(data?.data);
        }
        if (moon_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/MOON'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.moon_chart = JSON.stringify(data?.data);
        }
        if (birth_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D1'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.birth_chart = JSON.stringify(data?.data);
        }
        if (hora_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D2'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.hora_chart = JSON.stringify(data?.data);
        }
        if (drekkana_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D3'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.drekkana_chart = JSON.stringify(data?.data);
        }
        if (chaturthamsha_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D4'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.chaturthamsha_chart = JSON.stringify(data?.data);
        }
        if (saptamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D7'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.saptamsa_chart = JSON.stringify(data?.data);
        }
        if (navamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D9'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.navamsa_chart = JSON.stringify(data?.data);
        }
        if (dasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D10'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.dasamsa_chart = JSON.stringify(data?.data);
        }
        if (dwadasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D12'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.dwadasamsa_chart = JSON.stringify(data?.data);
        }
        if (shodasamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D16'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.shodasamsa_chart = JSON.stringify(data?.data);
        }
        if (vimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D20'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.vimsamsa_chart = JSON.stringify(data?.data);
        }
        if (chaturvimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D24'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.chaturvimsamsa_chart = JSON.stringify(data?.data);
        }
        if (saptavimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D27'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.saptavimsamsa_chart = JSON.stringify(data?.data);
        }
        if (trimsamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D30'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.trimsamsa_chart = JSON.stringify(data?.data);
        }
        if (khavedamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D40'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.khavedamsa_chart = JSON.stringify(data?.data);
        }
        if (akshavedamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D45'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.akshavedamsa_chart = JSON.stringify(data?.data);
        }
        if (shastiamsa_chart == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v1/horoscope-chart/D60'
            const data = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
            upd.shastiamsa_chart = JSON.stringify(data?.data);
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
        const { dob, birth_time, name, gender, birth_place, sun_dasha, moon_dasha, mars_dasha, mercury_dasha, venus_dasha, saturn_dasha, jupiter_dasha, ketu_dasha, rahu_dasha } = kundli
        const upd = {}
        const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v1/maha-dasha-analysis'
        if (sun_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "sun" }])
            upd.sun_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (moon_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "moon" }])
            upd.moon_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (mars_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "mars" }])
            upd.mars_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (mercury_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "mercury" }])
            upd.mercury_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (venus_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "venus" }])
            upd.venus_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (saturn_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "saturn" }])
            upd.saturn_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (jupiter_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "jupiter" }])
            upd.jupiter_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (ketu_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "ketu" }])
            upd.ketu_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (rahu_dasha == null) {
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl, [{ key: "maha_dasha", value: "rahu" }])
            upd.rahu_dasha = JSON.stringify(chalitChartresponse?.data);
        }
        if (rahu_dasha == null) {
            const url = 'https://astroapi-3.divineapi.com/indian-api/v2/yogini-dasha'
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, url)
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
            sun_dasha: JSON.parse(kundli.sun_dasha),
            moon_dasha: JSON.parse(kundli.moon_dasha),
            mars_dasha: JSON.parse(kundli.mars_dasha),
            mercury_dasha: JSON.parse(kundli.mercury_dasha),
            venus_dasha: JSON.parse(kundli.venus_dasha),
            saturn_dasha: JSON.parse(kundli.saturn_dasha),
            ketu_dasha: JSON.parse(kundli.ketu_dasha),
            rahu_dasha: JSON.parse(kundli.rahu_dasha),
            jupiter_dasha: JSON.parse(kundli.jupiter_dasha),
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
        const { dob, birth_time, name, gender, birth_place, general_report, sookshma_dasha, kalsarpa_dosha, manglik_dosha, sadesati_dosha } = kundli
        const upd = {}
        if (general_report == null) {
            const ChartUrl = 'https://astroapi-3.divineapi.com/indian-api/v2/ascendant-report'
            const chalitChartresponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, ChartUrl)
            upd.general_report = JSON.stringify(chalitChartresponse?.data);
        }

        if (kalsarpa_dosha == null) {
            const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v1/kaal-sarpa-yoga'
            const sookshmadasharesponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Vimshottari, [{ key: "dasha_type", value: "sookshma-dasha" }])
            upd.kalsarpa_dosha = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (manglik_dosha == null) {
            const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v2/manglik-dosha'
            const sookshmadasharesponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Vimshottari)
            upd.manglik_dosha = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (sadesati_dosha == null) {
            const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v2/sadhe-sati'
            const sookshmadasharesponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Vimshottari)
            upd.sadesati_dosha = JSON.stringify(sookshmadasharesponse?.data);
        }

        if (sookshma_dasha == null) {
            const Vimshottari = 'https://astroapi-3.divineapi.com/indian-api/v1/vimshottari-dasha'
            const sookshmadasharesponse = await basicKundliApiCall(dob, birth_time, name, gender, birth_place, Vimshottari, [{ key: "dasha_type", value: "sookshma-dasha" }])
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
            general_report: JSON.parse(kundli.general_report),
            kalsarpa_dosha: JSON.parse(kundli.kalsarpa_dosha),
            manglik_dosha: JSON.parse(kundli.manglik_dosha),
            sadesati_dosha: JSON.parse(kundli.sadesati_dosha),
            sookshma_dasha: JSON.parse(kundli.sookshma_dasha),
        }
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getHororscope(req, res) {
    try {
        const { type, rashi } = req.query;
        if (!type) return res.status(400).json({ success: false, message: 'Missing params.' });

        let kundli = await db('horoscope')
            .where({ type, rashi })
        const response = [];
        kundli?.map(item => {
            item.data = JSON.parse(item.data)
        })
        return res.status(200).json({ success: true, data: response, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}
module.exports = { findBasicKundli, findkundliTab, findkpTab, findAshtakvargaTab, findChartTab, findDashaTab, findReportTab, getHororscope };