const db = require('../db');
const { isValidMobile } = require('../utils/decodeJWT');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function createContactUs(req, res) {
    try {
        const { first_name, last_name, phone_no, email, city } = req.body || {};

        if (!first_name || !String(first_name).trim()) {
            return res.status(400).json({ success: false, message: 'First name is required.' });
        }
        if (!last_name || !String(last_name).trim()) {
            return res.status(400).json({ success: false, message: 'Last name is required.' });
        }
        if (!phone_no || !isValidMobile(phone_no)) {
            return res.status(400).json({ success: false, message: 'Enter valid phone number.' });
        }
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Enter valid email address.' });
        }
        if (!city || !String(city).trim()) {
            return res.status(400).json({ success: false, message: 'City is required.' });
        }

        const [contact] = await db('contact_us').insert({
            first_name: String(first_name).trim(),
            last_name: String(last_name).trim(),
            phone_no: String(phone_no).trim(),
            email: String(email).trim().toLowerCase(),
            city: String(city).trim(),
        }).returning(['id', 'first_name', 'last_name', 'phone_no', 'email', 'city', 'created_at']);

        return res.status(201).json({
            success: true,
            data: contact,
            message: 'Contact request submitted successfully.',
        });
    } catch (err) {
        console.error('createContactUs:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { createContactUs };
