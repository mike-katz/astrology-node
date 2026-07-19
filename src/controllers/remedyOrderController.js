const db = require('../db');
const axios = require('axios');
const { deepParse, convertCurrency } = require('../utils/decodeJWT');
const { callEvent } = require('../socket');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
require('dotenv').config();

const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERT = process.env.AGORA_APP_CERTIFICATE;
const JOIN_MODES = ['call', 'video', 'audio'];
const ACTIVE_STATUSES = ['pending', 'approved', 'in-progress'];

function calculateRating(pandit) {
    const r1 = Number(pandit.rating_1 || 0);
    const r2 = Number(pandit.rating_2 || 0);
    const r3 = Number(pandit.rating_3 || 0);
    const r4 = Number(pandit.rating_4 || 0);
    const r5 = Number(pandit.rating_5 || 0);
    const total = r1 + r2 + r3 + r4 + r5;
    if (total === 0) return 0;
    const weighted = (r1 + r2 * 2 + r3 * 3 + r4 * 4 + r5 * 5) / total;
    return Number(weighted.toFixed(1));
}

function getFirstImage(image) {
    if (!image) return null;
    const parsed = deepParse(image);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[0];
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    return null;
}

function generateOrderId() {
    return `REM${Date.now()}${Math.floor(100000 + Math.random() * 900000)}`;
}

function parsePanditIds(panditId) {
    if (!panditId) return [];
    const parsed = deepParse(panditId);
    const ids = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    return ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id) && id > 0);
}

function parseDurationMinutes(duration) {
    if (!duration) return 60;
    const match = String(duration).match(/\d+/);
    const minutes = match ? Number(match[0]) : 60;
    return minutes > 0 ? minutes : 60;
}

function buildScheduledAt(scheduled_date, scheduled_time) {
    if (!scheduled_date || !scheduled_time) return null;
    const time = String(scheduled_time).trim();
    const normalizedTime = time.length === 5 ? `${time}:00` : time;
    const scheduledAt = new Date(`${scheduled_date}T${normalizedTime}`);
    return Number.isNaN(scheduledAt.getTime()) ? null : scheduledAt;
}

function generateAgoraToken(channelName, maxCallSeconds = 3600) {
    const uid = Math.floor(Math.random() * 900000) + 100000;
    const nowSec = Math.floor(Date.now() / 1000);
    const expire = nowSec + Math.max(maxCallSeconds, 60);
    const token = RtcTokenBuilder.buildTokenWithUid(
        AGORA_APP_ID,
        AGORA_APP_CERT,
        channelName,
        uid,
        RtcRole.PUBLISHER,
        expire
    );
    return {
        appId: AGORA_APP_ID,
        channelName,
        uid,
        token,
        maxCallSeconds: expire - nowSec,
    };
}

async function getOrderByQuery(order_id, id) {
    const query = db('remedy_orders').whereNull('deleted_at');
    if (order_id) return query.where({ order_id }).first();
    if (id) return query.where({ id: Number(id) }).first();
    return null;
}

function formatOrderRow(order) {
    return {
        id: order.id,
        order_id: order.order_id,
        user_id: order.user_id,
        pandit_id: order.pandit_id,
        pooja_id: order.pooja_id,
        remedy_id: order.remedy_id,
        pooja_name: order.pooja_name,
        amount: Number(order.amount),
        discount: Number(order.discount || 0),
        final_amount: Number(order.final_amount),
        currency: order.currency,
        join_mode: order.join_mode,
        status: order.status,
        pandit_instructions: order.pandit_instructions,
        user_instruction: order.user_instruction,
        is_ashirvad: order.is_ashirvad || false,
        person: order.person != null ? Number(order.person) : null,
        pincode: order.pincode || null,
        city: order.city || null,
        state: order.state || null,
        address: order.address || null,
        landmark: order.landmark || null,
        mobile: order.mobile || null,
        scheduled_date: order.scheduled_date,
        scheduled_time: order.scheduled_time,
        scheduled_at: order.scheduled_at,
        approved_at: order.approved_at,
        started_at: order.started_at,
        completed_at: order.completed_at,
        cancelled_at: order.cancelled_at,
        created_at: order.created_at,
    };
}

async function deductUserBalance(trx, userId, amount, message, orderId, panditId) {
    console.log("userId, amount, message, orderId, panditId", userId, amount, message, orderId, panditId);
    const user = await trx('users').where({ id: userId }).forUpdate().first();
    if (!user || Number(user.balance) < amount) {
        throw new Error('INSUFFICIENT_BALANCE');
    }
    const newBalance = Number(user.balance) - amount;
    await trx('users').where({ id: userId }).update({ balance: newBalance });
    await trx('balancelogs').insert({
        order_id: orderId,
        user_id: userId,
        pandit_id: panditId,
        user_old_balance: Number(user.balance),
        user_new_balance: newBalance,
        amount: -amount,
        message,
        currency: user.default_currency || 'INR',
    });
    return { user, newBalance };
}

async function refundUserBalance(trx, userId, amount, message, orderId, panditId) {
    const user = await trx('users').where({ id: userId }).forUpdate().first();
    if (!user) throw new Error('USER_NOT_FOUND');
    const newBalance = Number(user.balance) + amount;
    await trx('users').where({ id: userId }).update({ balance: newBalance });
    await trx('balancelogs').insert({
        order_id: orderId,
        user_id: userId,
        pandit_id: panditId,
        user_old_balance: Number(user.balance),
        user_new_balance: newBalance,
        amount,
        message,
        currency: user.default_currency || 'INR',
    });
    return { user, newBalance };
}

async function creditPanditBalance(trx, panditId, amount, message, orderId, userId, userName) {
    const pandit = await trx('pandits').where({ id: panditId }).forUpdate().first();
    if (!pandit) throw new Error('PANDIT_NOT_FOUND');
    const newBalance = Number(pandit.balance || 0) + amount;
    await trx('pandits').where({ id: panditId }).update({ balance: newBalance });
    await trx('balancelogs').insert({
        order_id: orderId,
        user_id: userId,
        pandit_id: panditId,
        pandit_old_balance: Number(pandit.balance || 0),
        pandit_new_balance: newBalance,
        pandit_amount: amount,
        pandit_message: message,
        amount: 0,
        message: `Remedy order completed with ${userName}`,
        currency: 'INR',
    });
}

async function notifyUser(userId, title, body, data = {}) {
    const user = await db('users').where({ id: userId }).select('token').first();
    if (!user?.token) return;
    try {
        const admin = require('../config/firebase');
        await admin.messaging().send({
            token: user.token,
            notification: { title, body },
            data: Object.fromEntries(Object.entries(data).map(([k, v]) => [String(k), String(v)])),
        });
    } catch (err) {
        console.error('notifyUser error:', err.message);
    }
}

async function notifyPandit(panditId, title, body, data = {}) {
    const pandit = await db('pandits').where({ id: panditId }).select('token').first();
    if (!pandit?.token) return;
    try {
        const admin = require('../config/firebase');
        await admin.messaging().send({
            token: pandit.token,
            notification: { title, body },
            data: Object.fromEntries(Object.entries(data).map(([k, v]) => [String(k), String(v)])),
        });
    } catch (err) {
        console.error('notifyPandit error:', err.message);
    }
}

function getPriceArray(priceArray) {
    if (!priceArray) return [];
    const parsed = deepParse(priceArray);
    return Array.isArray(parsed) ? parsed : [];
}

function getSamuhikPrice(priceArray, person) {
    const prices = getPriceArray(priceArray);
    const match = prices.find((item) => Number(item?.person) === Number(person));
    if (!match) return null;
    const amount = Number(match.amount || 0);
    const discount = Number(match.discount || 0);
    return {
        amount,
        discount,
        finalAmountInr: Math.max(amount - discount, 0),
    };
}

async function createOrder(req, res) {
    try {
        const {
            pooja_id,
            pandit_id,
            is_ashirvad,
            person,
            pincode,
            city,
            state,
            address,
            landmark,
            mobile,
        } = req.body;

        if (!pooja_id) {
            return res.status(400).json({ success: false, message: 'Pooja id is required.' });
        }

        const pooja = await db('astroremedypoojas as p')
            .leftJoin('astroremedies as r', 'r.id', 'p.remedy_id')
            .select('p.*', 'r.name as remedy_name', 'r.is_ashirvad as category_is_ashirvad')
            .where({ 'p.id': Number(pooja_id), 'p.status': true })
            .whereNull('p.deleted_at')
            .whereNull('r.deleted_at')
            .first();
        if (!pooja) {
            return res.status(400).json({ success: false, message: 'Pooja not found.' });
        }

        const panditIds = parsePanditIds(pooja.pandit_id);
        let panditId = null;
        if (pandit_id) {
            const requestedPanditId = Number(pandit_id);
            if (Number.isNaN(requestedPanditId) || requestedPanditId <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid pandit id.' });
            }
            if (panditIds.length && !panditIds.includes(requestedPanditId)) {
                return res.status(400).json({ success: false, message: 'Selected pandit is not assigned to this pooja.' });
            }
            panditId = requestedPanditId;
        }

        const isAshirvad = is_ashirvad === true
            || is_ashirvad === 'true'
            || is_ashirvad === 1
            || is_ashirvad === '1'
            || pooja.is_ashirvad === true
            || pooja.category_is_ashirvad === true;

        let ashirvadData = {
            is_ashirvad: false,
            pincode: null,
            city: null,
            state: null,
            address: null,
            landmark: null,
            mobile: null,
        };

        if (isAshirvad) {
            if (!pincode || !city || !state || !address || !landmark || !mobile) {
                return res.status(400).json({
                    success: false,
                    message: 'Pincode, city, state, address, landmark and mobile are required for ashirvad.',
                });
            }
            ashirvadData = {
                is_ashirvad: true,
                pincode: String(pincode).trim(),
                city: String(city).trim(),
                state: String(state).trim(),
                address: String(address).trim(),
                landmark: String(landmark).trim(),
                mobile: String(mobile).trim(),
            };
        }

        const isSamuhik = String(pooja.pooja_type || '').toLowerCase() === 'samuhik';
        let personCount = null;
        let amount = Number(pooja.amount);
        let discount = Number(pooja.discount || 0);
        let finalAmountInr = Math.max(amount - discount, 0);

        if (isSamuhik) {
            if (person == null || person === '') {
                return res.status(400).json({ success: false, message: 'Person count is required for samuhik pooja.' });
            }
            personCount = Number(person);
            if (Number.isNaN(personCount) || personCount <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid person count.' });
            }

            const matchedPrice = getSamuhikPrice(pooja.price_array, personCount);
            if (!matchedPrice) {
                return res.status(400).json({ success: false, message: 'Price not found for selected person count.' });
            }
            amount = matchedPrice.amount;
            discount = matchedPrice.discount;
            finalAmountInr = matchedPrice.finalAmountInr;
        }

        const activeOrder = await db('remedy_orders')
            .where({ user_id: req.userId, pooja_id: Number(pooja_id) })
            .whereNotIn('status', ['cancelled', 'completed'])
            .whereNull('deleted_at')
            .first();
        if (activeOrder) {
            return res.status(400).json({ success: false, message: 'Please wait while complete your on going order.' });
        }

        const user = await db('users').where({ id: req.userId }).first();
        const currency = user?.default_currency || 'INR';
        const currencyData = await db('currency')
            .select('currency_name', 'user_inr_rate')
            .where({ currency_name: currency })
            .first();

        const finalAmount = convertCurrency(finalAmountInr, currencyData?.user_inr_rate || 1);
        if (Number(user?.balance) < finalAmount) {
            return res.status(400).json({ success: false, message: 'Insufficient wallet balance. Please recharge.' });
        }

        const orderId = generateOrderId();
        let savedOrder;

        await db.transaction(async (trx) => {
            await deductUserBalance(
                trx,
                req.userId,
                finalAmount,
                `Remedy order - ${pooja.name}`,
                orderId,
                panditId
            );

            [savedOrder] = await trx('remedy_orders').insert({
                order_id: orderId,
                user_id: req.userId,
                pandit_id: panditId,
                pooja_id: Number(pooja_id),
                remedy_id: pooja.remedy_id,
                pooja_name: pooja.name,
                amount,
                discount,
                final_amount: finalAmount,
                currency,
                status: 'pending',
                person: personCount,
                ...ashirvadData,
            }).returning('*');
        });

        if (panditId) {
            callEvent('emit_to_remedy_order_pending', {
                key: `pandit_${panditId}`,
                payload: { order_id: orderId, pandit_id: panditId },
            });
            notifyPandit(panditId, 'New Remedy Order', `New remedy order for ${pooja.name}`, { order_id: orderId, type: 'remedy_order' });
        }

        return res.status(200).json({
            success: true,
            data: formatOrderRow(savedOrder),
            message: 'Remedy order created successfully.',
        });
    } catch (err) {
        if (err.message === 'INSUFFICIENT_BALANCE') {
            return res.status(400).json({ success: false, message: 'Insufficient wallet balance. Please recharge.' });
        }
        console.error('createOrder:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function addUserInstruction(req, res) {
    try {
        const { order_id, user_instruction } = req.body;
        if (!order_id || !user_instruction?.trim()) {
            return res.status(400).json({ success: false, message: 'Order id and user instruction are required.' });
        }

        const order = await getOrderByQuery(order_id);
        if (!order || order.user_id !== Number(req.userId)) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }
        if (!['pending', 'approved'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'Instruction can only be added for pending or approved orders.' });
        }

        const [updated] = await db('remedy_orders').where({ id: order.id }).update({
            user_instruction: user_instruction.trim(),
            updated_at: new Date(),
        }).returning('*');

        return res.status(200).json({
            success: true,
            data: formatOrderRow(updated),
            message: 'User instruction added successfully.',
        });
    } catch (err) {
        console.error('addUserInstruction:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function approveOrder(req, res) {
    try {
        const { order_id, pandit_instructions, scheduled_date, scheduled_time } = req.body;
        if (!order_id || !pandit_instructions || !scheduled_date || !scheduled_time) {
            return res.status(400).json({ success: false, message: 'Order id, instructions, date and time are required.' });
        }

        const scheduledAt = buildScheduledAt(scheduled_date, scheduled_time);
        if (!scheduledAt) {
            return res.status(400).json({ success: false, message: 'Invalid scheduled date or time.' });
        }

        const order = await getOrderByQuery(order_id);
        if (!order || order.pandit_id !== Number(req.userId)) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }
        if (order.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Only pending orders can be approved.' });
        }

        const [updated] = await db('remedy_orders').where({ id: order.id }).update({
            status: 'approved',
            pandit_instructions,
            scheduled_date,
            scheduled_time,
            scheduled_at: scheduledAt,
            approved_at: new Date(),
            updated_at: new Date(),
        }).returning('*');

        callEvent('emit_to_remedy_order_approved', {
            key: `user_${order.user_id}`,
            payload: { order_id: order.order_id, scheduled_at: scheduledAt },
        });
        notifyUser(
            order.user_id,
            'Remedy Order Approved',
            `Your remedy order is scheduled on ${scheduled_date} at ${scheduled_time}`,
            { order_id: order.order_id, type: 'remedy_order' }
        );

        return res.status(200).json({
            success: true,
            data: formatOrderRow(updated),
            message: 'Remedy order approved successfully.',
        });
    } catch (err) {
        console.error('approveOrder:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function startOrder(req, res) {
    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res.status(400).json({ success: false, message: 'Order id is required.' });
        }

        const order = await getOrderByQuery(order_id);
        if (!order || order.pandit_id !== Number(req.userId)) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }
        if (order.status !== 'approved') {
            return res.status(400).json({ success: false, message: 'Only approved orders can be started.' });
        }

        const now = new Date();
        if (order.scheduled_at && new Date(order.scheduled_at) > now) {
            return res.status(400).json({ success: false, message: 'Scheduled muhurat time has not arrived yet.' });
        }

        const pooja = await db('astroremedypoojas').where({ id: order.pooja_id }).first();
        const durationMinutes = parseDurationMinutes(pooja?.duration);
        let callData = null;

        const [updated] = await db('remedy_orders').where({ id: order.id }).update({
            status: 'in-progress',
            started_at: now,
            updated_at: now,
        }).returning('*');

        if (order.join_mode === 'call') {
            const userDetail = await db('users').select('mobile', 'country_code').where({ id: order.user_id }).first();
            const panditDetail = await db('pandits').select('mobile', 'country_code').where({ id: order.pandit_id }).first();
            const numbers = ['+911413232575', '+911413231101', '+911413232574', '+911413231093'];
            const did = numbers[Math.floor(Math.random() * numbers.length)];
            try {
                const response = await axios({
                    method: 'post',
                    url: process.env.CALL_URL,
                    headers: { Authorization: process.env.CALL_TOKEN },
                    data: {
                        source: `${panditDetail?.country_code}${panditDetail?.mobile}`,
                        destination: `${userDetail?.country_code}${userDetail?.mobile}`,
                        did,
                        order_id: order.order_id,
                    },
                });
                if (response?.data?.call_id) {
                    await db('remedy_orders').where({ id: order.id }).update({ call_id: response.data.call_id });
                    callData = { call_id: response.data.call_id, mode: 'call' };
                }
            } catch (callErr) {
                console.error('startOrder call error:', callErr.message);
            }
        } else {
            callData = {
                mode: order.join_mode,
                ...generateAgoraToken(order.order_id, durationMinutes * 60),
            };
        }

        callEvent('emit_to_remedy_order_started', {
            key: `user_${order.user_id}`,
            payload: {
                order_id: order.order_id,
                join_mode: order.join_mode,
                call_data: callData,
            },
        });
        notifyUser(
            order.user_id,
            'Remedy Session Started',
            `Your ${order.join_mode} session has started. Please join now.`,
            { order_id: order.order_id, join_mode: order.join_mode, type: 'remedy_order' }
        );

        return res.status(200).json({
            success: true,
            data: {
                ...formatOrderRow(updated),
                call_data: callData,
            },
            message: 'Remedy order started successfully.',
        });
    } catch (err) {
        console.error('startOrder:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function completeOrder(req, res) {
    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res.status(400).json({ success: false, message: 'Order id is required.' });
        }

        const order = await getOrderByQuery(order_id);
        if (!order || order.pandit_id !== Number(req.userId)) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }
        if (order.status !== 'in-progress') {
            return res.status(400).json({ success: false, message: 'Only in-progress orders can be completed.' });
        }

        const pandit = await db('pandits').where({ id: order.pandit_id }).first();
        const user = await db('users').where({ id: order.user_id }).first();
        const panditShare = Number(pandit?.chat_call_share || 100);
        const panditAmount = (Number(order.final_amount) * panditShare) / 100;

        let updated;
        await db.transaction(async (trx) => {
            [updated] = await trx('remedy_orders').where({ id: order.id }).update({
                status: 'completed',
                completed_at: new Date(),
                updated_at: new Date(),
            }).returning('*');

            await creditPanditBalance(
                trx,
                order.pandit_id,
                panditAmount,
                `Remedy order completed - ${order.pooja_name}`,
                order.order_id,
                order.user_id,
                user?.name || 'User'
            );

            await trx('pandits').where({ id: order.pandit_id }).increment('total_orders', 1);
        });

        callEvent('emit_to_remedy_order_completed', {
            key: `user_${order.user_id}`,
            payload: { order_id: order.order_id },
        });
        notifyUser(
            order.user_id,
            'Remedy Session Completed',
            'Please share your feedback or raise a complaint if needed.',
            { order_id: order.order_id, type: 'remedy_order_feedback' }
        );

        return res.status(200).json({
            success: true,
            data: formatOrderRow(updated),
            message: 'Remedy order completed successfully.',
        });
    } catch (err) {
        console.error('completeOrder:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function rejectOrder(req, res) {
    try {
        const { order_id, reason } = req.body;
        if (!order_id) {
            return res.status(400).json({ success: false, message: 'Order id is required.' });
        }

        const order = await getOrderByQuery(order_id);
        if (!order || order.pandit_id !== Number(req.userId)) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }
        if (!['pending', 'approved'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'This order cannot be rejected.' });
        }

        let updated;
        await db.transaction(async (trx) => {
            [updated] = await trx('remedy_orders').where({ id: order.id }).update({
                status: 'rejected',
                pandit_instructions: reason || order.pandit_instructions,
                cancelled_at: new Date(),
                updated_at: new Date(),
            }).returning('*');

            await refundUserBalance(
                trx,
                order.user_id,
                Number(order.final_amount),
                `Remedy order refund - ${order.pooja_name}`,
                order.order_id,
                order.pandit_id
            );
        });

        notifyUser(order.user_id, 'Remedy Order Rejected', 'Your payment has been refunded to wallet.', { order_id: order.order_id });

        return res.status(200).json({
            success: true,
            data: formatOrderRow(updated),
            message: 'Remedy order rejected and amount refunded.',
        });
    } catch (err) {
        console.error('rejectOrder:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function cancelOrder(req, res) {
    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res.status(400).json({ success: false, message: 'Order id is required.' });
        }

        const order = await getOrderByQuery(order_id);
        if (!order || order.user_id !== Number(req.userId)) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }
        if (!['pending'].includes(order.status)) {
            return res.status(400).json({ success: false, message: 'This order cannot be cancelled.' });
        }

        let updated;
        await db.transaction(async (trx) => {
            [updated] = await trx('remedy_orders').where({ id: order.id }).update({
                status: 'cancelled',
                cancelled_at: new Date(),
                updated_at: new Date(),
            }).returning('*');

            await refundUserBalance(
                trx,
                order.user_id,
                Number(order.final_amount),
                `Remedy order cancelled - ${order.pooja_name}`,
                order.order_id,
                order.pandit_id
            );
        });

        notifyPandit(order?.pandit_id, 'Remedy Order Cancelled', ``, { order_id: order.order_id });
        return res.status(200).json({
            success: true,
            data: formatOrderRow(updated),
            message: 'Remedy order cancelled and amount refunded.',
        });
    } catch (err) {
        console.error('cancelOrder:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function joinOrder(req, res) {
    try {
        const { order_id } = req.body;
        if (!order_id) {
            return res.status(400).json({ success: false, message: 'Order id is required.' });
        }

        const order = await getOrderByQuery(order_id);
        if (!order || order.user_id !== Number(req.userId)) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }
        if (order.status !== 'in-progress') {
            return res.status(400).json({ success: false, message: 'Order is not in progress.' });
        }

        const pooja = await db('astroremedypoojas').where({ id: order.pooja_id }).first();
        const durationMinutes = parseDurationMinutes(pooja?.duration);

        if (order.join_mode === 'call') {
            return res.status(200).json({
                success: true,
                data: {
                    order_id: order.order_id,
                    join_mode: order.join_mode,
                    call_id: order.call_id,
                },
                message: 'Call session is active.',
            });
        }

        const callData = generateAgoraToken(order.order_id, durationMinutes * 60);
        return res.status(200).json({
            success: true,
            data: {
                order_id: order.order_id,
                join_mode: order.join_mode,
                ...callData,
            },
            message: 'Join token generated successfully.',
        });
    } catch (err) {
        console.error('joinOrder:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function addFeedback(req, res) {
    try {
        const { order_id, rating, message } = req.body;
        if (!order_id || !rating || !message) {
            return res.status(400).json({ success: false, message: 'message and rating are required.' });
        }
        const order = await db('remedy_orders').where({ order_id, user_id: Number(req.userId) }).first();
        if (!order) return res.status(400).json({ success: false, message: 'order not found.' });
        if (order.status !== 'completed') {
            return res.status(400).json({ success: false, message: 'Feedback is allowed only after order completion.' });
        }

        console.log("{ order_id: order.order_id, user_id: req.userId }", { order_id: order.order_id, user_id: req.userId });
        const existing = await db('astroremedireviews')
            .where({ order_id: order.order_id, user_id: Number(req.userId) })
            .first();
        if (existing) {
            await db('astroremedireviews').where({ id: existing?.id }).update({
                rating: Number(rating),
                message,
                status: 'pending'
            })
        } else {
            await db('astroremedireviews').insert({
                user_id: req.userId,
                pandit_id: order.pandit_id,
                rating: Number(rating),
                message,
                status: 'pending',
                pooja_id: order.pooja_id,
                order_id: order.order_id,
            });
        }
        // if (type === 'review' && rating) {
        //     const ratingKey = `rating_${Number(rating)}`;
        //     if (['rating_1', 'rating_2', 'rating_3', 'rating_4', 'rating_5'].includes(ratingKey)) {
        //         await db('pandits').where({ id: order.pandit_id }).increment(ratingKey, 1);
        //     }
        // }

        return res.status(200).json({
            success: true,
            data: null,
            message: 'Review submitted successfully.'
        });
    } catch (err) {
        console.error('addFeedback:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getUserOrders(req, res) {
    try {
        let page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 20;
        const { status } = req.query;
        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const offset = (page - 1) * limit;

        let query = db('remedy_orders as ro')
            .leftJoin('pandits as p', 'p.id', 'ro.pandit_id')
            .leftJoin('astroremedypoojas as ap', 'ap.id', 'ro.pooja_id')
            .select(
                'ro.*',
                'p.display_name as pandit_name',
                'p.profile as pandit_profile',
                'ap.duration'
            )
            .where({ 'ro.user_id': req.userId })
            .whereNull('ro.deleted_at')
            .orderBy('ro.id', 'desc')
            .limit(limit)
            .offset(offset);

        let countQuery = db('remedy_orders').where({ user_id: req.userId }).whereNull('deleted_at');
        if (status) {
            query = query.andWhere('ro.status', status);
            countQuery = countQuery.andWhere('status', status);
        }

        const rows = await query;
        const [{ count }] = await countQuery.count('* as count');
        const total = parseInt(count, 10);

        const orderIds = rows.map((row) => row.id);


        const results = rows.map((row) => ({
            ...formatOrderRow(row),
            pandit_name: row.pandit_name,
            pandit_profile: row.pandit_profile,
            duration: row.duration
        }));

        return res.status(200).json({
            success: true,
            data: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                results,
            },
            message: 'Remedy orders fetched successfully.',
        });
    } catch (err) {
        console.error('getUserOrders:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getPanditOrders(req, res) {
    try {
        let page = parseInt(req.query.page, 10) || 1;
        let limit = parseInt(req.query.limit, 10) || 20;
        const { status } = req.query;
        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const offset = (page - 1) * limit;

        let query = db('remedy_orders as ro')
            .leftJoin('users as u', 'u.id', 'ro.user_id')
            .select('ro.*', 'u.name as user_name', 'u.profile as user_profile', 'u.avatar as user_avatar')
            .where({ 'ro.pandit_id': req.userId })
            .whereNull('ro.deleted_at')
            .orderBy('ro.id', 'desc')
            .limit(limit)
            .offset(offset);

        let countQuery = db('remedy_orders').where({ pandit_id: req.userId }).whereNull('deleted_at');
        if (status) {
            query = query.andWhere('ro.status', status);
            countQuery = countQuery.andWhere('status', status);
        }

        const rows = await query;
        const [{ count }] = await countQuery.count('* as count');
        const total = parseInt(count, 10);

        const results = rows.map((row) => ({
            ...formatOrderRow(row),
            user_name: row.user_name,
            user_profile: row.user_profile,
            user_avatar: row.user_avatar,
        }));

        return res.status(200).json({
            success: true,
            data: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                results,
            },
            message: 'Remedy orders fetched successfully.',
        });
    } catch (err) {
        console.error('getPanditOrders:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getOrderDetail(req, res) {
    try {
        const { order_id, id } = req.query;
        if (!order_id && !id) {
            return res.status(400).json({ success: false, message: 'Order id is required.' });
        }

        const order = await db('remedy_orders as ro')
            .leftJoin('pandits as p', 'p.id', 'ro.pandit_id')
            .leftJoin('users as u', 'u.id', 'ro.user_id')
            .select(
                'ro.*',
                'p.display_name as pandit_name',
                'p.profile as pandit_profile',
                'p.rating_1',
                'p.rating_2',
                'p.rating_3',
                'p.rating_4',
                'p.rating_5',
                'p.total_orders',
                'u.name as user_name',
                'u.profile as user_profile'
            )
            .modify((qb) => {
                if (order_id) qb.where('ro.order_id', order_id);
                else qb.where('ro.id', Number(id));
            })
            .whereNull('ro.deleted_at')
            .first();

        if (!order) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }

        const isUser = order.user_id === Number(req.userId);
        const isPandit = order.pandit_id === Number(req.userId);
        if (!isUser && !isPandit) {
            return res.status(400).json({ success: false, message: 'Order not found.' });
        }

        const feedbacks = await db('remedy_order_chat').where({ remedy_order_id: order.id });
        const logs = await db('remedy_order_logs as rol')
            .leftJoin('pandits as p', 'p.id', 'rol.pandit_id')
            .select(
                'rol.*',
                'p.display_name',
                'p.profile'
            )
            .where({ "rol.order_id": order.order_id });
        const pooja = await db('astroremedypoojas').where({ id: order.pooja_id }).first();

        return res.status(200).json({
            success: true,
            data: {
                ...formatOrderRow(order),
                pandit_name: order.pandit_name,
                pandit_profile: order.pandit_profile,
                user_name: order.user_name,
                user_profile: order.user_profile,
                rating: calculateRating(order),
                total_orders: Number(order.total_orders || 0),
                chat: feedbacks,
                logs,
                pooja_type: pooja?.pooja_type,
                duration: pooja?.duration,
                image: getFirstImage(pooja?.image),
            },
            message: 'Remedy order detail fetched successfully.',
        });
    } catch (err) {
        console.error('getOrderDetail:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = {
    createOrder,
    addUserInstruction,
    approveOrder,
    startOrder,
    completeOrder,
    rejectOrder,
    cancelOrder,
    joinOrder,
    addFeedback,
    getUserOrders,
    getPanditOrders,
    getOrderDetail,
};
