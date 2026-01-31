const db = require('../db');
const crypto = require('crypto');
require('dotenv').config();
const generateInvoicePDF = require('../utils/generatepdf');
const { callEvent } = require('../socket');

function numberToIndianWords(amount) {
    if (amount === undefined || amount === null) return '';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function convertBelowThousand(num) {
        let str = '';
        if (num > 99) { str += ones[Math.floor(num / 100)] + ' Hundred '; num %= 100; }
        if (num > 19) { str += tens[Math.floor(num / 10)] + ' '; num %= 10; }
        if (num > 0) str += ones[num] + ' ';
        return str.trim();
    }
    function convertNumber(num) {
        let result = '';
        if (num >= 10000000) { result += convertBelowThousand(Math.floor(num / 10000000)) + ' Crore '; num %= 10000000; }
        if (num >= 100000) { result += convertBelowThousand(Math.floor(num / 100000)) + ' Lakh '; num %= 100000; }
        if (num >= 1000) { result += convertBelowThousand(Math.floor(num / 1000)) + ' Thousand '; num %= 1000; }
        result += convertBelowThousand(num);
        return result.trim();
    }
    const rupees = Math.floor(amount);
    const paise = Math.round((amount - rupees) * 100);
    let words = convertNumber(rupees) + ' Rupees';
    if (paise > 0) words += ' and ' + convertNumber(paise) + ' Paise';
    return words + ' Only';
}

/**
 * Razorpay webhook: Step 1 – payment success/fail nu status set
 * Step 2 – DB ma jyare status "pending" hoy tyare j success/failed update karvu
 * Raw body use thay (server.js ma /callback/razorpay par express.raw set che) – req.body Buffer hoy
 */
async function razorpay(req, res) {
    try {
        console.log("razorpay req body", JSON.stringify(req.body));
        console.log("razorpay req query", JSON.stringify(req.query));
        const rawBody = req.body instanceof Buffer ? req.body : (typeof req.body === 'string' ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body)));
        const bodyStr = rawBody.toString('utf8');
        const signature = req.headers['x-razorpay-signature'];
        console.log("signature", signature);
        // if (!signature) {
        //     return res.status(400).send('Missing signature');
        // }
        // const gateway = await db('payment_gateways').where('status', true).first();
        // const webhookSecret = gateway?.credentials?.webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET || '';
        // if (!webhookSecret) {
        //     console.error('Razorpay webhook secret not configured');
        //     return res.status(500).send('Webhook not configured');
        // }
        // const expectedSign = crypto.createHmac('sha256', webhookSecret).update(bodyStr).digest('hex');
        // if (expectedSign !== signature) {
        //     return res.status(400).send('Invalid signature');
        // }

        let payload;
        try {
            payload = JSON.parse(bodyStr);
        } catch (e) {
            return res.status(400).send('Invalid JSON');
        }
        // Razorpay events: payment.failed | payment.authorized | payment.captured | order.paid
        const event = payload.event;

        // 1. payment.authorized – only acknowledged, no DB update (wait for captured/order.paid)
        if (event === 'payment.authorized') {
            return res.status(200).json({ success: true, message: 'payment.authorized acknowledged' });
        }

        // 2. payment.failed | 3. payment.captured | 4. order.paid
        const status = (event === 'payment.captured' || event === 'order.paid') ? 'success' : (event === 'payment.failed') ? 'failed' : null;
        if (!status) {
            return res.status(200).json({ success: true, message: 'Event ignored' });
        }

        console.log("status", status);

        const pay = payload.payload?.payment?.entity;
        const orderEntity = payload.payload?.order?.entity;
        let orderId, razorpayPaymentId, amountPaise, utr;
        if (pay) {
            orderId = pay.order_id;
            razorpayPaymentId = pay.id;
            amountPaise = Number(pay.amount || 0);
            utr = pay.acquirer_data?.rrn || pay.id;
        } else if (orderEntity) {
            orderId = orderEntity.id;
            amountPaise = Number(orderEntity.amount || 0);
            const p = payload.payload?.payment?.entity;
            razorpayPaymentId = p?.id || null;
            utr = p?.acquirer_data?.rrn || razorpayPaymentId;
        } else {
            return res.status(200).json({ success: true, message: 'No payment or order entity' });
        }
        const amountInr = amountPaise / 100;

        // Same order: find row by Razorpay order_id (transaction_id). Failed path = only pending. Success path = pending or failed (retry pachi success)
        console.log("orderId", orderId);
        const paymentRow = await db('payments')
            .where({ order_id: orderId })
            .whereIn('status', status === 'failed' ? ['pending'] : ['pending', 'failed'])
            .first();
        if (!paymentRow) {
            return res.status(200).json({ success: true, message: 'No pending payment or already processed' });
        }

        // 2. payment.failed – mark payment as failed
        if (status === 'failed') {
            await db('payments').where({ id: paymentRow.id }).update({ status: 'failed', transaction_id: razorpayPaymentId });
            return res.status(200).json({ success: true, message: 'Payment marked failed' });
        }

        const user = await db('users').where('id', paymentRow.user_id).first();
        if (!user) {
            await db('payments').where({ id: paymentRow.id }).update({ status: 'failed' });
            return res.status(200).json({ success: true, message: 'User not found' });
        }

        const gst = Number(paymentRow?.gst);
        const with_tax_amount = Number(Number(gst) + Number(paymentRow?.amount)).toFixed(2);
        const total_in_word = numberToIndianWords(with_tax_amount);

        let extra = 0;
        if (paymentRow.recharge_id) {
            const recharge = await db('recharges').where('id', paymentRow.recharge_id).first();
            if (recharge) {
                extra = Number(recharge?.extra_amount)
            }
        }

        const newBalance = Number(user.balance) + Number(paymentRow?.amount);

        const data = {
            transaction_id: razorpayPaymentId,
            utr,
            amount: paymentRow?.amount,
            with_tax_amount,
            gst,
            city: user?.city_state_country || '',
            pincode: user?.pincode || '',
            total_in_word,
        };
        const invoice = await generateInvoicePDF(data);

        await db('payments').where({ id: paymentRow.id }).update({
            utr,
            transaction_id: razorpayPaymentId,
            status: 'success',
            invoice,
        });

        await db('users').where({ id: user.id }).increment({ balance: Number(Number(paymentRow?.amount) + Number(extra)) });

        await db('balancelogs').insert({
            user_old_balance: Number(user.balance),
            user_new_balance: Number(newBalance),
            user_id: user.id,
            message: 'Purchase of AG-Money via Razorpay',
            amount: paymentRow?.amount,
            gst,
            invoice,
        });

        if (extra > 0) {
            await db('balancelogs').insert({
                user_old_balance: Number(newBalance),
                user_new_balance: Number(newBalance) + Number(extra),
                user_id: user.id,
                message: `Cashback Order(${orderId})`,
                amount: extra,
                gst: 0,
                invoice: "",
            });
        }

        const order = await db('orders').where({ user_id: user.id, status: 'continue' }).first();
        if (order) {
            const minute = Math.floor(Number(paymentRow?.amount) / Number(order?.rate || order?.final_chat_call_rate || 1));
            const endTime = new Date(new Date(order.end_time).getTime() + minute * 60 * 1000);
            const duration = Number(order?.duration) + Number(minute);
            const rate = order?.rate || order?.final_chat_call_rate;
            const deduction = Number(duration) * Number(rate);
            await db('orders').where({ id: order.id }).update({ duration, deduction, end_time: endTime });
            if (order.type === 'chat') {
                callEvent('emit_to_user_chat_end_time', { key: `pandit_${order.pandit_id}`, payload: { startTime: order.start_time, endTime, orderId: order.order_id } });
                callEvent('emit_to_user_chat_end_time', { key: `user_${order.user_id}`, payload: { startTime: order.start_time, endTime, orderId: order.order_id } });
            }
            if (order.type === 'call') {
                callEvent('emit_to_user_call_end_time', { key: `pandit_${order.pandit_id}`, payload: { startTime: order.start_time, endTime, orderId: order.order_id } });
                callEvent('emit_to_user_call_end_time', { key: `user_${order.user_id}`, payload: { startTime: order.start_time, endTime, orderId: order.order_id } });
            }
            callEvent('emit_to_pending_order', { key: `pandit_${order.pandit_id}`, payload: { pandit_id: order.pandit_id } });
        }

        return res.status(200).json({ success: true, message: 'Payment success updated' });
    } catch (err) {
        console.error('razorpay callback:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { razorpay };
