const db = require('../db');
require('dotenv').config();
const generateInvoicePDF = require('../utils/generatepdf');

function numberToIndianWords(amount) {
    if (amount === undefined || amount === null) return '';

    const ones = [
        '', 'One', 'Two', 'Three', 'Four', 'Five',
        'Six', 'Seven', 'Eight', 'Nine', 'Ten',
        'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
        'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
    ];

    const tens = [
        '', '', 'Twenty', 'Thirty', 'Forty',
        'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
    ];

    function convertBelowThousand(num) {
        let str = '';

        if (num > 99) {
            str += ones[Math.floor(num / 100)] + ' Hundred ';
            num %= 100;
        }

        if (num > 19) {
            str += tens[Math.floor(num / 10)] + ' ';
            num %= 10;
        }

        if (num > 0) {
            str += ones[num] + ' ';
        }

        return str.trim();
    }

    function convertNumber(num) {
        let result = '';

        if (num >= 10000000) {
            result += convertBelowThousand(Math.floor(num / 10000000)) + ' Crore ';
            num %= 10000000;
        }

        if (num >= 100000) {
            result += convertBelowThousand(Math.floor(num / 100000)) + ' Lakh ';
            num %= 100000;
        }

        if (num >= 1000) {
            result += convertBelowThousand(Math.floor(num / 1000)) + ' Thousand ';
            num %= 1000;
        }

        result += convertBelowThousand(num);
        return result.trim();
    }

    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);

    let words = convertNumber(rupees) + ' Rupees';

    if (paise > 0) {
        words += ' and ' + convertNumber(paise) + ' Paise';
    }

    return words + ' Only';
}

async function addPayment(req, res) {
    try {
        const { amount } = req.body;
        if (!amount) return res.status(400).json({ success: false, message: 'Missing params.' });
        const user = await db('users')
            .where('id', req?.userId)
            .first();
        if (!user) return res.status(400).json({ success: false, message: 'User not found.' });

        const orderId = Math.floor(100000000000000 + Math.random() * 900000000000000).toString();
        const utr = Math.floor(100000000 + Math.random() * 900000000).toString();
        const gst = (Number(amount) * 18) / 100

        const with_tax_amount = Number(Number(gst) + Number(amount)).toFixed(2);
        const total_in_word = numberToIndianWords(with_tax_amount)

        const data = {
            transaction_id: orderId,
            utr,
            amount,
            with_tax_amount,
            gst,
            address: user?.current_address || "",
            city: user?.city_state_country || "",
            pincode: user?.pincode || "",
            total_in_word
        };
        const invoice = await generateInvoicePDF(data)
        console.log("invoice", invoice);
        await db('users').where({ id: user?.id }).increment({ balance: Number(amount) });
        await db('payments').insert({ user_id: req?.userId, transaction_id: orderId, utr, gst, amount, status: "success", invoice, type: "recharge" });
        const newBalance = Number(user.balance) + Number(amount)
        await db('balancelogs').insert({
            user_old_balance: Number(user.balance), user_new_balance: Number(newBalance), user_id: req?.userId, message: "Purchase of ATG-Money via razorpay", amount, gst, invoice
        });

        return res.status(200).json({ success: true, message: 'Payment added Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getPayment(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 100;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;
        const log = await db('payments')
            .whereNull('deleted_at')
            .andWhere('user_id', req.userId)
            .orderBy('id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await db('payments')
            .count('* as count')
            .whereNull('deleted_at')
            .andWhere('user_id', req.userId);
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: log
        }
        return res.status(200).json({ success: true, data: response, message: 'List Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getTransactions(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 100;

        if (page < 1) page = 1;
        if (limit < 1) limit = 100;
        const offset = (page - 1) * limit;
        const log = await db('balancelogs')
            .whereNull('deleted_at')
            .andWhere('user_id', req.userId)
            .orderBy('id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await db('balancelogs')
            .count('* as count')
            .whereNull('deleted_at')
            .andWhere('user_id', req.userId);
        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);

        const response = {
            page,
            limit,
            total,
            totalPages,
            results: log
        }
        return res.status(200).json({ success: true, data: response, message: 'List Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteSinglePayment(req, res) {
    const { id } = req.query;
    try {
        if (!id) return res.status(400).json({ success: false, message: 'Missing params.' });
        await db('payments').where({
            'id': id,
            'user_id': req?.userId
        }).update({ deleted_at: new Date() });
        return res.status(200).json({ success: true, data: null, message: 'Delete Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteSingleTransaction(req, res) {
    const { id } = req.query;
    try {
        if (!id) return res.status(400).json({ success: false, message: 'Missing params.' });
        await db('balancelogs').where({
            'id': id,
            'user_id': req?.userId
        }).update({ deleted_at: new Date() });
        return res.status(200).json({ success: true, data: null, message: 'Delete Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteAllPayment(req, res) {
    try {
        await db('payments').where({
            'user_id': req?.userId
        }).update({ deleted_at: new Date() });
        return res.status(200).json({ success: true, data: null, message: 'Delete Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function deleteAllTransaction(req, res) {
    try {
        await db('balancelogs').where({
            'user_id': req?.userId
        }).update({ deleted_at: new Date() });
        return res.status(200).json({ success: true, data: null, message: 'Delete Successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { addPayment, getPayment, getTransactions, deleteSinglePayment, deleteSingleTransaction, deleteAllPayment, deleteAllTransaction };