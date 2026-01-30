const db = require('../db');
require('dotenv').config();

async function razorpay(req, res) {
    try {
        console.log("razorpay req body", req.body);
        console.log("razorpay req qiery", req.query);
        // const faqs = await db('faqs')
        //     .whereNull('deleted_at')
        //     .orderBy('id', 'asc')
        //     .limit(limit)
        //     .offset(offset);

        return res.status(200).json({ success: true, data: null, message: 'FAQ list retrieved successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { razorpay };
