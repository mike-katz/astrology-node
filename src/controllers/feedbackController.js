const db = require('../db');
const { isValidMobile } = require('../utils/decodeJWT');

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function createFeedback(req, res) {
    try {
        const { mobile, email, name, subject, content, device_id } = req.body || {};

        // if (!mobile && !email) {
        //     return res.status(400).json({ success: false, message: 'Mobile or email is required.' });
        // }
        // if (!name || !String(name).trim()) {
        //     return res.status(400).json({ success: false, message: 'Name is required.' });
        // }
        // if (!subject || !String(subject).trim()) {
        //     return res.status(400).json({ success: false, message: 'Subject is required.' });
        // }
        if (!content || !String(content).trim()) {
            return res.status(400).json({ success: false, message: 'Content is required.' });
        }

        const [feedback] = await db('feedbacks').insert({
            user_id: req.userId || null,
            mobile: mobile || null,
            email: email ? String(email).trim().toLowerCase() : null,
            name: String(name).trim(),
            subject: String(subject).trim(),
            content: String(content).trim(),
            device_id: device_id || null,
            status: "pending"
        }).returning(['id', 'mobile', 'email', 'name', 'subject', 'content', 'device_id', 'created_at']);

        return res.status(200).json({
            success: true,
            data: feedback,
            message: 'Feedback submitted successfully.',
        });
    } catch (err) {
        console.error('createFeedback:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { createFeedback };
