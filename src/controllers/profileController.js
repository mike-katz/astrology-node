const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { makeAvtarString } = require('./userController');
require('dotenv').config();

const MARITAL_STATUS = ['single', 'married', 'divorced', 'separated', 'widowed'];
const OCCUPATION = ['private_sector', 'govt_sector', 'business_self_employed', 'civil_services', 'defence', 'not_working', 'student'];
const TOPIC_OF_CONCERN = ['career_and_business', 'marriage', 'love_and_relationship', 'wealth_and_property', 'education', 'legal_matters', 'child_name_consultation',
    'business_name_consultation', 'gem_stone_consultation', 'commodity_trading_consultation', 'match_making', 'birth_time_rectification', 'name_correction_consultation',
    'travel_abroad_consulation', 'remedy_consultation', 'health_consultation', 'other'];
const GENDER = ['male', 'female', 'other'];

async function addProfile(req, res) {
    try {
        const { name, gender, dob, dot, is_enable_partner_detail, partner_place, partner_dot, partner_dob, partner_name, birth_place, marital_status, occupation, topic_of_concern, topic_of_concern_other, lat = '22.82', lng = '70.84' } = req.body;
        if (!name || !gender || !dob || !dot || !birth_place) return res.status(400).json({ success: false, message: 'Missing params.' });

        if (gender && !GENDER.includes(gender)) return res.status(400).json({ success: false, message: 'Enter valid gender.' });
        if (marital_status && !MARITAL_STATUS.includes(marital_status)) return res.status(400).json({ success: false, message: 'Enter valid marital status.' });
        if (occupation && !OCCUPATION.includes(occupation)) return res.status(400).json({ success: false, message: 'Enter valid occupation.' });
        if (topic_of_concern && !TOPIC_OF_CONCERN.includes(topic_of_concern)) return res.status(400).json({ success: false, message: 'Enter valid concern.' });
        if (is_enable_partner_detail) {
            if (!partner_place || !partner_dot || !partner_dob || !partner_name) return res.status(400).json({ success: false, message: 'Missing partner details.' });
        }

        const [{ count }] = await db('userprofiles')
            .count('* as count').where('user_id', req?.userId);
        console.log("count", count);
        if (count > 4) {
            return res.status(400).json({ success: false, message: 'Your profile limit is over.' });
        }
        const ins = {
            user_id: req.userId,
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
            topic_of_concern_other,
            occupation,
            birth_place,
            lng,
            lat,
            marital_status
        }
        const response = await db('userprofiles').insert(ins).returning('*');

        if (count == 0) {
            delete ins.is_first
            delete ins.user_id
            delete ins.lat
            delete ins.lng
            await db('users').where({ id: req.userId }).update(ins);
        }
        return res.status(200).json({ success: true, data: response, message: 'Profile Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getList(req, res) {
    try {
        const user = await db('userprofiles')
            .where('user_id', req.userId)
            .orderBy('id', 'desc');
        return res.status(200).json({ success: true, data: user, message: 'Profile get Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function updateProfile(req, res) {
    try {
        const { profileId, name, gender, dob, dot, is_enable_partner_detail, partner_place, partner_dot, partner_dob, partner_name, birth_place, marital_status, occupation, topic_of_concern, topic_of_concern_other, lat, lng } = req.body;
        if (!profileId) return res.status(400).json({ success: false, message: 'Missing params.' });
        console.log("req.body", req.body);
        if (gender && !GENDER.includes(gender)) return res.status(400).json({ success: false, message: 'Enter valid gender.' });
        if (marital_status && !MARITAL_STATUS.includes(marital_status)) return res.status(400).json({ success: false, message: 'Enter valid marital status.' });
        if (occupation && !OCCUPATION.includes(occupation)) return res.status(400).json({ success: false, message: 'Enter valid occupation.' });
        if (topic_of_concern && !TOPIC_OF_CONCERN.includes(topic_of_concern)) return res.status(400).json({ success: false, message: 'Enter valid concern.' });
        if (is_enable_partner_detail) {
            if (!partner_place || !partner_dot || !partner_dob || !partner_name) return res.status(400).json({ success: false, message: 'Missing partner details.' });
        }

        const count = await db('userprofiles')
            .where({ 'id': profileId, 'user_id': req?.userId }).first();
        if (!count) {
            return res.status(400).json({ success: false, message: 'Profile not found.' });
        }
        const upd = { is_updated: true }
        //     topic_of_concern,
        //     topic_of_concern_other,
        //     occupation,
        //     birth_place,
        //     marital_status
        // }
        let avatar;
        if (name) {
            upd.name = name
            avatar = await makeAvtarString(name, gender)
        }
        if (gender) {
            upd.gender = gender
            avatar = await makeAvtarString(name, gender)
        } if (dob) {
            upd.dob = dob
        } if (dot) {
            upd.birth_time = dot
        } if (is_enable_partner_detail != undefined) {
            upd.is_enable_partner_detail = is_enable_partner_detail
        } if (partner_place) {
            upd.partner_place = partner_place
        } if (partner_dot) {
            upd.partner_dot = partner_dot
        } if (partner_dob) {
            upd.partner_dob = partner_dob
        } if (partner_name) {
            upd.partner_name = partner_name
        } if (topic_of_concern) {
            upd.topic_of_concern = topic_of_concern
        } if (topic_of_concern_other) {
            upd.topic_of_concern_other = topic_of_concern_other
        }
        if (occupation) {
            upd.occupation = occupation
        }
        if (birth_place) {
            upd.birth_place = birth_place
        }
        if (marital_status) {
            upd.marital_status = marital_status
        }
        if (lat) {
            upd.lat = lat
        }
        if (lng) {
            upd.lng = lng
        }
        await db('userprofiles').where('id', profileId).update(upd);

        if (count.is_first) {
            delete upd.is_updated

            if (avatar) {
                upd.avatar = avatar
            }
            await db('users').where({ id: req.userId }).update(upd);
        }
        const newUser = await db('users').where({ id: req.userId }).first();
        return res.status(200).json({ success: true, data: { profile: newUser?.profile, avatar: newUser?.avatar }, message: 'Profile Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteProfile(req, res) {
    const { profileId } = req.query;
    try {
        console.log("req.query", req.query);
        if (!profileId) return res.status(400).json({ success: false, message: 'Profile not found.' });
        const count = await db('userprofiles')
            .where({ 'id': profileId, 'user_id': req?.userId }).first();
        if (!count) {
            return res.status(400).json({ success: false, message: 'Profile not found.' });
        }
        if (count?.is_first) {
            return res.status(400).json({ success: false, message: 'Your main profile not be delete.' });
        }
        await db('userprofiles')
            .where({
                'id': profileId,
                'user_id': req?.userId
            })
            .del();
        return res.status(200).json({ success: true, data: null, message: 'Profile delete Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { addProfile, getList, updateProfile, deleteProfile };