const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function addProfile(req, res) {
    try {
        const { name, gender, dob, dot, is_enable_partner_detail, partner_place, partner_dot, partner_dob, partner_name, birth_place, marital_status, occupation, topic_of_concern, topic_of_concern_other } = req.body;
        if (!name || !gender || !dob || !dot || !is_enable_partner_detail || !birth_place || !marital_status || !occupation) return res.status(400).json({ success: false, message: 'Please select pandit.' });

        const [{ count }] = await db('userprofiles')
            .count('* as count').where('userId', req?.userId);

        console.log("user", user);
        const ins = {
            userId: req.userId,
            is_first: count != 0 ? false : true,
            name,
            gender,
            dob,
            birth_time: dot,
            is_enable_partner_detail,
            partner_place,
            partner_dot,
            partner_dob,
            partner_name,
            topic_of_concern,
            topic_of_concern_other
        }
        await db('userprofiles').insert(ins);

        if (count == 0) {
            delete ins.is_first
            await db('user').where({ id: req.userId }).update(ins);

        }
        return res.status(200).json({ success: true, message: 'Review Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function addReplay(req, res) {
    try {
        const { ratingId, replay } = req.body;
        if (!ratingId || !replay) return res.status(400).json({ success: false, message: 'Please enter replay.' });
        const user = await db('reviews')
            .where('panditId', req?.userId)
            .where('id', ratingId)
            .first();
        console.log("user", user);
        if (!user) return res.status(400).json({ success: false, message: 'You already follow this pandit' });
        if (user) {
            await db('reviews')
                .where('id', user?.id)
                .update({ replay });
        }
        return res.status(200).json({ success: true, message: 'Replay Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getList(req, res) {
    try {
        const { panditId } = req.query;
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;

        if (!panditId) return res.status(400).json({ success: false, message: 'Please enter pandit.' });
        const user = await db('userprofile')
            .where('userId', req.userId).limit(limit)
            .offset(offset);

        const [{ count }] = await db('reviews')
            .count('* as count').where('panditId', panditId);
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: user
        }
        return res.status(200).json({ success: true, data: response, message: 'Review get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { addProfile, addReplay, getList };