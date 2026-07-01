const db = require('../db');
const crypto = require('crypto');
require('dotenv').config();
const generateInvoicePDF = require('../utils/generatepdf');
const { callEvent } = require('../socket');
const path = require('path');
const { emitCallDurationUpdate } = require('../callSocket');
const logger = require('log4js').getLogger(path.parse(__filename).name);

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

async function getRechargeBonus(user, paymentRow) {
    let extra = 0;
    if (paymentRow?.offer_amount > 0) {
        return extra
    }
    const [{ count }] = await db('payments')
        .count('* as count')
        .where({ user_id: paymentRow.user_id })
        .whereIn('status', ['success']);
    const rechargeNo = Number(count) + 1;
    const recharges = await db('recharges')
        .whereIn('recharge_number', [1111, rechargeNo])
        .whereNull('deleted_at');
    const matchedRecharge =
        recharges.find(r => r.recharge_number === rechargeNo) ||
        recharges.find(r => r.recharge_number === 1111);
    if (!matchedRecharge) return extra;

    const userCurrency = user?.default_currency || 'INR';
    const amounts = matchedRecharge?.amounts?.[userCurrency] || matchedRecharge?.amounts || [];
    const amountsList = Array.isArray(amounts) ? amounts : (typeof amounts === 'string' ? JSON.parse(amounts || '[]') : []);
    const currencyRate = await db('currency').where('currency_name', userCurrency).first();
    const inrRate = Number(currencyRate?.user_inr_rate || 1);
    const taxPercent = Number(currencyRate?.user_tax_percentage || 0);
    const currencyTax = taxPercent + 100;

    const matched = amountsList.find((a) => {
        const rechargeBaseInr = Math.round(((Number(a.amount) * 100) / currencyTax) * inrRate * 100);
        const paymentInrAmount = Math.round(Number(paymentRow.amount) * 100);
        return rechargeBaseInr === paymentInrAmount;
    });

    if (!matched) return extra;

    const d = matched.discount;
    const dt = matched.discount_type;
    if (d == null || d === '' || dt == null || dt === '') {
        return 0;
    }
    if (String(dt).toLowerCase() === 'amount') {
        return Number(d) * inrRate;
    }
    if (String(dt).toLowerCase() === 'percentage') {
        return (Number(paymentRow.amount) * Number(d)) / 100;
    }
    return 0;
}

/**
 * Razorpay webhook: Step 1 – payment success/fail nu status set
 * Step 2 – DB ma jyare status "pending" hoy tyare j success/failed update karvu
 * Raw body use thay (server.js ma /callback/razorpay par express.raw set che) – req.body Buffer hoy
 */
async function razorpay(req, res) {
    logger.info('razorpay callback start');
    try {
        let rawBody;
        if (req.body instanceof Buffer) {
            rawBody = req.body;
            console.log("rawBody", rawBody);
        } else if (typeof req.body === 'string') {
            rawBody = Buffer.from(req.body);
            console.log("rawBody", rawBody);
        } else if (req.body != null) {
            rawBody = Buffer.from(JSON.stringify(req.body));
            console.log("rawBody", rawBody);
        }
        else {
            return res.status(400).send('Missing request body');
        }

        const bodyStr = rawBody.toString('utf8');
        console.log("bodyStr", bodyStr);
        logger.info('razorpay callback req.body', bodyStr);

        const signature = req.headers['x-razorpay-signature'];
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
            console.log("razorpay callback req.body", payload);
        } catch (e) {
            return res.status(400).send('Invalid JSON');
        }
        console.log("payload", payload);
        // Razorpay events: payment.failed | payment.authorized | payment.captured | order.paid
        const event = payload.event;

        // 1. payment.authorized – only acknowledged, no DB update (wait for captured/order.paid)
        if (event === 'payment.authorized') {
            return res.status(200).json({ success: true, message: 'payment.authorized acknowledged' });
        }

        // 2. payment.failed | 3. payment.captured | 4. order.paid
        const status = (event === 'payment.captured' || event === 'order.paid') ? 'success' : (event === 'payment.failed') ? 'failed' : null;
        if (!status) {
            logger.info('event ignore case', payload.payload?.payment?.entity?.order_id);
            return res.status(200).json({ success: true, message: 'Event ignored' });
        }

        logger.info('start processing payment event', event)
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
        const paymentRow = await db('payments')
            .where({ order_id: orderId })
            .whereIn('status', status === 'failed' ? ['pending'] : ['pending', 'failed'])
            .first();
        if (!paymentRow) {
            return res.status(200).json({ success: true, message: 'No pending payment or already processed' });
        }

        // 2. payment.failed – mark payment as failed
        if (status === 'failed') {
            logger.info('failed case', razorpayPaymentId);
            await db('payments').where({ id: paymentRow.id }).update({ status: 'failed', transaction_id: razorpayPaymentId });
            return res.status(200).json({ success: true, message: 'Payment marked failed' });
        }

        const user = await db('users').where('id', paymentRow.user_id).first();
        if (!user) {
            logger.info('user not found case', razorpayPaymentId);
            await db('payments').where({ id: paymentRow.id }).update({ status: 'failed' });
            return res.status(200).json({ success: true, message: 'User not found' });
        }

        const gst = Number(paymentRow?.gst);
        const with_tax_amount = Number(Number(gst) + Number(paymentRow?.amount)).toFixed(2);
        const total_in_word = numberToIndianWords(Number(with_tax_amount).toFixed(2),);

        // user/recharge logic: amounts array ma amount match kari ne discount apply
        const extra = await getRechargeBonus(user, paymentRow);

        logger.info(`bonus amount for ${user?.mobile} ${extra}`);
        logger.info(`payment amount for ${user?.mobile} ${paymentRow?.amount}`);

        const newBalance = Number(user.balance) + Number(paymentRow?.amount);

        const data = {
            transaction_id: razorpayPaymentId,
            utr,
            amount: Number(paymentRow?.amount).toFixed(2),
            with_tax_amount: Number(with_tax_amount).toFixed(2),
            gst: Number(gst).toFixed(2),
            city: user?.city_state_country || '',
            pincode: user?.pincode || '',
            total_in_word,
        };

        logger.info(`user= ${user?.mobile} old balance ${user.balance} new balance ${Number(Number(paymentRow?.amount) + Number(extra))} extra bonus= ${extra} `);

        const [saved] = await db('balancelogs').insert({
            user_old_balance: Number(user.balance),
            user_new_balance: Number(newBalance),
            user_id: user.id,
            message: `Purchase of AG-Money via Razorpay (${razorpayPaymentId})`,
            amount: paymentRow?.amount,
            gst,
        }).returning('*');
        await db('payments').where({ id: paymentRow.id }).update({
            utr,
            transaction_id: razorpayPaymentId,
            status: 'success',
        });
        await db('users').where({ id: user.id }).increment({ balance: Number(Number(paymentRow?.amount) + Number(extra)), offer_amount: Number(paymentRow?.offer_amount || 0) });

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

        if (paymentRow?.offer_amount > 0) {
            await db('balancelogs').insert({
                user_old_balance: Number(newBalance),
                user_new_balance: Number(newBalance) + Number(extra || 0) + Number(paymentRow?.offer_amount),
                user_id: user.id,
                message: `Offer Bonus Order(${receiptId})`,
                amount: Number(paymentRow?.offer_amount) - Number(paymentRow?.amount),
                currency: paymentRow?.currency,
                gst: 0,
                invoice: "",
            });
        }

        const order = await db('orders').where({ user_id: user.id, status: 'continue', is_free: false }).first();
        if (order) {
            const minute = Math.floor(Number(paymentRow?.amount) / Number(order?.rate || order?.final_chat_call_rate || 1));
            const endTime = new Date(new Date(order.end_time).getTime() + minute * 60 * 1000);
            const duration = Number(order?.duration) + Number(minute);
            const rate = order?.rate || order?.final_chat_call_rate;
            const deduction = Number(duration) * Number(rate);
            await db('orders').where({ id: order.id }).update({ duration, deduction, end_time: endTime });
            if (order.type === 'chat') {
                callEvent('emit_to_user_chat_end_time', { key: `pandit_${order.pandit_id}`, payload: { startTime: order.start_time, endTime, orderId: order.order_id, user_id: order?.user_id } });
                callEvent('emit_to_user_chat_end_time', { key: `user_${order.user_id}`, payload: { startTime: order.start_time, endTime, orderId: order.order_id, pandit_id: order?.pandit_id } });
            }
            if (order.type === 'call') {
                callEvent('emit_to_user_call_end_time', { key: `pandit_${order.pandit_id}`, payload: { startTime: order.start_time, endTime, orderId: order.order_id } });
                callEvent('emit_to_user_call_end_time', { key: `user_${order.user_id}`, payload: { startTime: order.start_time, endTime, orderId: order.order_id } });
            }
            callEvent('emit_to_pending_order', { key: `pandit_${order.pandit_id}`, payload: { pandit_id: order.pandit_id } });

            // normal call event start
            if (order?.call_id) {
                const currentTime = new Date();
                const diffInSec = Math.floor((endTime - currentTime) / 1000);
                console.log(diffInSec);
                emitCallDurationUpdate(order?.call_id, diffInSec)
            }
        }

        const invoice = await generateInvoicePDF(data);
        logger.info("payment invoice", invoice);
        await db('payments').where({ id: paymentRow.id }).update({
            invoice
        });
        await db('balancelogs').where({ id: saved.id }).update({
            invoice
        });

        logger.info('razorpay callback end');
        return res.status(200).json({ success: true, message: 'Payment success updated' });
    } catch (err) {
        logger.info('razorpay callback error catch', err);
        console.error('razorpay callback:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function xpay(req, res) {
    logger.info('xpay callback start body', req.body);
    logger.info('xpay callback start query', req.query);
    const { eventType, intentId, status, receiptId } = req.body
    try {
        if (status == 'FAILED') {
            const paymentRow = await db('payments')
                .where({ order_id: intentId })
                .whereIn('status', ['pending', 'canceled'])
                .first();
            if (!paymentRow) {
                return res.status(200).json({ success: true, message: 'No pending payment or already processed' });
            }
            await db('payments').where({ id: paymentRow.id }).update({ status: 'failed' });
            return res.status(200).json({ success: true, message: 'payment.intent acknowledged' });
        }
        if (status == 'CANCEL') {
            const paymentRow = await db('payments')
                .where({ order_id: intentId, status: 'pending' })
                .first();
            if (!paymentRow) {
                return res.status(200).json({ success: true, message: 'No pending payment or already processed' });
            }
            await db('payments').where({ id: paymentRow.id }).update({ status: 'canceled' });
            return res.status(200).json({ success: true, message: 'payment.intent acknowledged' });
        }

        if (eventType != 'intent.success') {
            return res.status(200).json({ success: true, message: 'payment.intent acknowledged' });
        }

        if (status != 'SUCCESS') {
            return res.status(200).json({ success: true, message: 'payment.intent acknowledged' });
        }

        const paymentRow = await db('payments')
            .where({ order_id: intentId })
            .whereIn('status', ['pending', 'failed', 'canceled'])
            .first();
        if (!paymentRow) {
            return res.status(200).json({ success: true, message: 'No pending payment or already processed' });
        }

        const user = await db('users').where('id', paymentRow.user_id).first();
        if (!user) {
            logger.info('user not found case', intentId);
            await db('payments').where({ id: paymentRow.id }).update({ status: 'failed' });
            return res.status(200).json({ success: true, message: 'User not found' });
        }


        const gst = Number(paymentRow?.gst);
        const with_tax_amount = Number(Number(gst) + Number(paymentRow?.amount)).toFixed(2);
        const total_in_word = numberToIndianWords(Number(with_tax_amount).toFixed(2),);

        const extra = await getRechargeBonus(user, paymentRow);

        logger.info(`bonus amount for ${user?.mobile} ${extra}`);
        logger.info(`payment amount for ${user?.mobile} ${paymentRow?.amount}`);

        const newBalance = Number(user.balance) + Number(paymentRow?.amount);

        const data = {
            transaction_id: receiptId,
            utr: "",
            amount: Number(paymentRow?.amount).toFixed(2),
            with_tax_amount: Number(with_tax_amount).toFixed(2),
            gst: Number(gst).toFixed(2),
            city: user?.city_state_country || '',
            pincode: user?.pincode || '',
            total_in_word,
        };

        logger.info(`user= ${user?.mobile} old balance ${user.balance} new balance ${Number(Number(paymentRow?.amount) + Number(extra))} extra bonus= ${extra} `);

        const [saved] = await db('balancelogs').insert({
            user_old_balance: Number(user.balance),
            user_new_balance: Number(newBalance),
            user_id: user.id,
            message: `Purchase of AG-Money via xpay (${receiptId})`,
            amount: paymentRow?.amount,
            currency: paymentRow?.currency,
            gst,
        }).returning('*');
        await db('payments').where({ id: paymentRow.id }).update({
            utr: "",
            transaction_id: receiptId,
            status: 'success',
        });

        const amount = paymentRow?.offer_amount > 0 ? paymentRow?.offer_amount : paymentRow?.amount
        await db('users').where({ id: user.id }).increment({ balance: Number(Number(amount) + Number(extra)), offer_amount: Number(paymentRow?.offer_amount || 0) });

        if (extra > 0) {
            await db('balancelogs').insert({
                user_old_balance: Number(newBalance),
                user_new_balance: Number(newBalance) + Number(extra),
                user_id: user.id,
                message: `Cashback Order(${receiptId})`,
                amount: extra,
                currency: paymentRow?.currency,
                gst: 0,
                invoice: "",
            });
        }

        if (paymentRow?.offer_amount > 0) {
            await db('balancelogs').insert({
                user_old_balance: Number(newBalance),
                user_new_balance: Number(newBalance) + Number(extra || 0) + Number(paymentRow?.offer_amount),
                user_id: user.id,
                message: `Offer Bonus Order(${receiptId})`,
                amount: Number(paymentRow?.offer_amount) - Number(paymentRow?.amount),
                currency: paymentRow?.currency,
                gst: 0,
                invoice: "",
            });
        }

        const invoice = await generateInvoicePDF(data);
        logger.info("payment invoice", invoice);
        await db('payments').where({ id: paymentRow.id }).update({
            invoice
        });
        await db('balancelogs').where({ id: saved.id }).update({
            invoice
        });
        logger.info('xpay callback end');
        return res.status(200).json({ success: true, message: 'Payment success updated' });
    }
    catch (err) {
        logger.info('xpay callback error catch', err);
        console.error('xpay callback:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { razorpay, xpay };
