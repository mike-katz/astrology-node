const db = require('../db');

require('dotenv').config();

async function getProfile(req, res) {
    const user = await db('users')
        .where('id', req?.userId)
        .first();
    if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
    return res.status(200).json({ success: true, data: user, message: 'Profile get Successfully' });
}

async function updateProfile(req, res) {
    try {
        const { name, gender, dob, birthTime = '12:00 AM', birthPlace, currentAddress, city, pincode, language } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Please enter name.' });
        const user = await db('users')
            .where('id', req?.userId)
            .first();
        if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
        const update = {}
        if (name) {
            update.name = name
        }
        if (gender) {
            update.gender = gender
        }
        if (dob) {
            update.dob = dob
        }
        if (birthTime) {
            update.birth_time = birthTime
        }
        if (birthPlace) {
            update.birth_place = birthPlace
        }
        if (currentAddress) {
            update.current_address = currentAddress
        }
        if (city) {
            update.city = city
        }
        if (pincode) {
            update.pincode = pincode
        }
        if (language?.length > 0) {
            update.language = language ? JSON.stringify(language) : {}
        }

        await db('users')
            .where('id', user?.id)
            .update(update);

        const isProfileExist = await db('userprofiles')
            .where({ 'user_id': req?.userId }).first();
        if (isProfileExist) {
            delete update.language
            delete update.pincode
            delete update.city
            delete update.current_address
            await db('userprofiles')
                .where('id', isProfileExist?.id)
                .update(update);
        } else {
            delete update.language
            delete update.pincode
            delete update.city
            delete update.current_address

            update.is_first = true;
            update.user_id = req.userId
            await db('userprofiles')
                .insert(update);
        }
        return res.status(200).json({ success: true, message: 'Profile update Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getBalance(req, res) {
    const user = await db('users')
        .where('id', req?.userId)
        .select('balance')
        .first();
    if (!user) return res.status(400).json({ success: false, message: 'Please enter correct user.' });
    return res.status(200).json({ success: true, data: user, message: 'Profile get Successfully' });
}

async function updateToken(req, res) {
    const { token } = req.body;
    try {
        const order = await db('users').where({ id: req.userId }).first();
        if (!order) return res.status(400).json({ success: false, message: 'Pandit not found.' });
        const update = {}
        if (token) {
            update.token = token
        }
        await db('users').where({ id: req.userId }).update(update);
        return res.status(200).json({ success: true, data: null, message: 'Update successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}
module.exports = { updateProfile, getProfile, getBalance, updateToken };