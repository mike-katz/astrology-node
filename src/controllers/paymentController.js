const db = require('../db');
const crypto = require('crypto');
const { callEvent } = require('../socket');
require('dotenv').config();
const generateInvoicePDF = require('../utils/generatepdf');
const Razorpay = require('razorpay');

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

/** Create Razorpay order (no SMS/OTP – use Razorpay Checkout on frontend) */
async function createRazorpayOrder(req, res) {
    try {
        const { amount } = req.body;
        if (!amount || Number(amount) < 1) {
            return res.status(400).json({ success: false, message: 'Amount is required and must be at least ₹1.' });
        }
        const gateway = await db('payment_gateways').where('status', true).first();
        // { "key_id": "rzp_test_S9nToUfWEFILCz", "key_secret": "HTbBCXlFb7xEa2rVltcKIvNy", "merchant_id": "S5qAOpGWOEM7L9" }

        const keyId = gateway?.credentials?.key_id || "rzp_test_S9nToUfWEFILCz";
        const keySecret = gateway?.credentials?.key_secret || "HTbBCXlFb7xEa2rVltcKIvNy";
        if (!keyId || !keySecret) {
            return res.status(500).json({ success: false, message: 'Razorpay is not configured.' });
        }
        const user = await db('users').where('id', req.userId).first();
        if (!user) return res.status(400).json({ success: false, message: 'User not found.' });

        const instance = new Razorpay({ key_id: keyId, key_secret: keySecret });

        const base = (Number(amount) * 100) / (Number(118)) //add gst 18 +100

        const gst = Number(amount) - Number(base)
        const with_tax_amount = Number(amount).toFixed(2);

        const amountPaise = Math.round(Number(with_tax_amount) * 100);
        const receipt = `rcpt_${req.userId}_${Date.now()}`;
        const order = await instance.orders.create({
            amount: amountPaise,
            currency: 'INR',
            receipt,
            notes: { user_id: String(req.userId) },
        });
        console.log("order", order);

        await db('payments').insert({ user_id: req?.userId, order_id: order.id, gst, amount: base, status: "pending", type: "recharge" });
        return res.status(200).json({
            success: true,
            data: {
                orderId: order.id,
                key: keyId,
                amount: order.amount,
                currency: order.currency,
            },
            message: 'Order created.',
        });
    } catch (err) {
        console.error('createRazorpayOrder:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

/** Verify Razorpay payment signature and credit balance (no SMS) */
async function verifyRazorpayPayment(req, res) {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Missing razorpay_order_id, razorpay_payment_id or razorpay_signature.' });
        }

        const gateway = await db('payment_gateways').where('status', true).first();

        const keyId = gateway?.credentials?.key_id || "rzp_test_S9nToUfWEFILCz";
        const keySecret = gateway?.credentials?.key_secret || "HTbBCXlFb7xEa2rVltcKIvNy";

        if (!keySecret) {
            return res.status(500).json({ success: false, message: 'Razorpay is not configured.' });
        }

        const body = `${razorpay_order_id}|${razorpay_payment_id}`;
        const expectedSignature = crypto.createHmac('sha256', keySecret).update(body).digest('hex');
        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Invalid payment signature.' });
        }

        const existing = await db('payments')
            .where({ user_id: req.userId, order_id: razorpay_order_id })
            .orWhere({ utr: razorpay_payment_id })
            .first();
        if (existing) {
            return res.status(200).json({ success: true, message: 'Payment already processed.' });
        }

        const user = await db('users').where('id', req.userId).first();
        if (!user) return res.status(400).json({ success: false, message: 'User not found.' });

        const amountInr = Number((req.body.amount_inr != null ? req.body.amount_inr : 0)) || 0;
        let amount = amountInr;
        if (amount <= 0) {
            const instance = new Razorpay({
                key_id: keyId,
                key_secret: keySecret
            });
            const orderRes = await instance.orders.fetch(razorpay_order_id);
            console.log("orderRes", orderRes);
            amount = Number(orderRes.amount) / 100;
        }

        if (amount < 0.01) {
            return res.status(400).json({ success: false, message: 'Invalid amount.' });
        }

        const orderId = razorpay_order_id;
        const utr = razorpay_payment_id;
        const gst = (Number(amount) * 18) / 100;
        const with_tax_amount = Number(Number(gst) + Number(amount)).toFixed(2);
        const total_in_word = numberToIndianWords(with_tax_amount);
        const data = {
            transaction_id: razorpay_payment_id,
            utr,
            amount,
            with_tax_amount,
            gst,
            city: user?.city_state_country || '',
            pincode: user?.pincode || '',
            total_in_word,
        };
        const invoice = await generateInvoicePDF(data);

        await db('users').where({ id: user.id }).increment({ balance: Number(amount) });
        await db('payments').insert({
            user_id: req.userId,
            transaction_id: orderId,
            utr,
            gst,
            amount,
            status: 'success',
            invoice,
            type: 'recharge',
        });
        const newBalance = Number(user.balance) + Number(amount);

        const order = await db('orders').where({ user_id: req.userId, status: 'continue' }).first();
        if (order) {
            const minute = Math.floor(Number(amount) / Number(order?.rate || order?.final_chat_call_rate || 1));
            const endTime = new Date(new Date(order.end_time).getTime() + minute * 60 * 1000);
            const duration = Number(order?.duration) + Number(minute);
            const rate = order?.rate || order?.final_chat_call_rate;
            const deduction = Number(duration) * Number(rate);
            await db('orders').where({ id: order.id }).update({ duration, deduction, end_time: endTime });

            if (order.type === 'chat') {
                callEvent('emit_to_user_chat_end_time', {
                    key: `pandit_${order.pandit_id}`,
                    payload: { startTime: order.start_time, endTime, orderId: order.order_id },
                });
                callEvent('emit_to_user_chat_end_time', {
                    key: `user_${order.user_id}`,
                    payload: { startTime: order.start_time, endTime, orderId: order.order_id },
                });
            }
            if (order.type === 'call') {
                callEvent('emit_to_user_call_end_time', {
                    key: `pandit_${order.pandit_id}`,
                    payload: { startTime: order.start_time, endTime, orderId: order.order_id },
                });
                callEvent('emit_to_user_call_end_time', {
                    key: `user_${order.user_id}`,
                    payload: { startTime: order.start_time, endTime, orderId: order.order_id },
                });
            }
            callEvent('emit_to_pending_order', {
                key: `pandit_${order.pandit_id}`,
                payload: { pandit_id: order.pandit_id },
            });
        }

        await db('balancelogs').insert({
            user_old_balance: Number(user.balance),
            user_new_balance: Number(newBalance),
            user_id: req.userId,
            message: 'Purchase of AG-Money via Razorpay',
            amount,
            gst,
            invoice,
        });

        return res.status(200).json({ success: true, message: 'Payment verified and balance updated.' });
    } catch (err) {
        console.error('verifyRazorpayPayment:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
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
            city: user?.city_state_country || "",
            pincode: user?.pincode || "",
            total_in_word
        };
        const invoice = await generateInvoicePDF(data)
        console.log("invoice", invoice);
        await db('users').where({ id: user?.id }).increment({ balance: Number(amount) });
        await db('payments').insert({ user_id: req?.userId, transaction_id: orderId, utr, gst, amount, status: "success", invoice, type: "recharge" });
        const newBalance = Number(user.balance) + Number(amount)
        const order = await db('orders').where({ user_id: req.userId, status: "continue" }).first();
        if (order) {
            const minute = Math.floor(Number(Number(amount) / Number(order?.rate)));
            const endTime = new Date(new Date(order.end_time).getTime() + minute * 60 * 1000);
            const duration = Number(order?.duration) + Number(minute);
            const deduction = Number(duration) * Number(order.rate)
            await db('orders').where({ id: order?.id }).update({ duration, deduction, end_time: endTime });

            if (order.type == 'chat') {
                callEvent("emit_to_user_chat_end_time", {
                    key: `pandit_${order?.pandit_id}`,
                    payload: { startTime: order?.start_time, endTime, orderId: order?.orderId }
                });
                callEvent("emit_to_user_chat_end_time", {
                    key: `user_${order?.user_id}`,
                    payload: { startTime: order?.start_time, endTime, orderId: order?.orderId }
                });
            }
            if (order.type == 'call') {
                console.log("emit_to_user_call_end_time call start",);
                callEvent("emit_to_user_call_end_time", {
                    key: `pandit_${order?.pandit_id}`,
                    payload: { startTime: order?.start_time, endTime, orderId: order?.orderId }
                });
                callEvent("emit_to_user_call_end_time", {
                    key: `user_${order?.user_id}`,
                    payload: { startTime: order?.start_time, endTime, orderId: order?.orderId }
                });
                console.log("emit_to_user_call_end_time call end",);

            }

            callEvent("emit_to_pending_order", {
                key: `pandit_${order?.pandit_id}`,
                payload: { pandit_id: order?.pandit_id }
            });
        }
        await db('balancelogs').insert({
            user_old_balance: Number(user.balance), user_new_balance: Number(newBalance), user_id: req?.userId, message: "Purchase of AG-Money via razorpay", amount, gst, invoice
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

module.exports = {
    addPayment,
    getPayment,
    getTransactions,
    deleteSinglePayment,
    deleteSingleTransaction,
    deleteAllPayment,
    deleteAllTransaction,
    createRazorpayOrder,
    verifyRazorpayPayment,
};