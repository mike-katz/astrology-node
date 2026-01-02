const db = require('../db');
require('dotenv').config();
const { decodeJWT } = require('../utils/decodeJWT');
const axios = require('axios');
const FormData = require('form-data');
async function findBasicKundli(req, res) {
    try {
        let { profile_id, name, dob, type, birth_time, gender, birth_place } = req.query;
        if (!type) return res.status(400).json({ success: false, message: 'Missing params.' });

        const authHeader = req.headers.authorization;
        if (authHeader && type == 'profile' && authHeader.startsWith('Bearer ')) {
            const tokenData = decodeJWT(authHeader)
            if (!tokenData?.success) return res.status(400).json({ success: false, message: 'Your session expired.' });
            const user = await db('userprofiles')
                .where({ 'id': Number(profile_id), user_id: tokenData?.data?.userId })
                .first();
            if (!user) return res.status(400).json({ success: false, message: 'Your session expired.' });
            name = user?.name
            gender = user?.gender
            birth_time = user?.birth_time
            dob = user?.dob
            birth_place = user?.birth_place
        }
        let user = await db('kundlis')
            .where({ name, gender, dob, birth_place, birth_time })
            .first();

        if (!user) {
            console.log("inside api");
            const url = ' https://astroapi-3.divineapi.com/indian-api/v3/basic-astro-details'
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
            formData.append('lat', '25.7041');
            formData.append('lon', '77.1025');
            formData.append('tzone', '5.5');
            formData.append('lan', 'en');

            const config = {
                method: 'post',
                url,
                headers: {
                    Authorization: `Bearer ${process.env.KUNDLI_API_TOKEN}`,
                    ...formData.getHeaders(),
                },
                data: formData,
            };
            console.log("config", config);
            const response = await axios(config);
            console.log(response.data);

            user = { name, gender, dob, birth_place, birth_time }
            if (profile_id) {
                user.profile_id = profile_id
            }
            user.basic = JSON.stringify(response.data?.data)
            await db('kundlis').insert(user);
            // await db('follows').insert({ user_id: req?.userId, pandit_id: panditId, type: "user" });
        }
        return res.status(200).json({ success: true, data: user, message: 'Kundli get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}


module.exports = { findBasicKundli };