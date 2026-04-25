const crypto = require('crypto');
const db = require('../db');
const RedisCache = require('../config/redisClient');
const { callEvent } = require('../socket');
const logger = require('../utils/logger').getLogger('liveStreamingController');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const { channelLeave, geneateToken } = require('./agoraController');
const { balanceCut } = require('./chatController');

require('dotenv').config();

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERT = process.env.AGORA_APP_CERTIFICATE;
const TOKEN_EXPIRE_SECONDS = parseInt(process.env.AGORA_LIVE_TOKEN_EXPIRE_SECONDS, 10) || 86400;
const RESERVED_RECORDING_UID = 999999;

const LIVE_VIEWER_KEY = (channelId) => `live_stream:viewers:${channelId}`;
const LIVE_JOINED_USER_IDS_KEY = (channelId) => `live_stream:joined_user_ids:${channelId}`;

function emitLiveViewerCount(panditId, channel_id, viewer_count, user_id, joined_user_ids, profile_id) {
    try {
        callEvent('emit_to_live_viewer_count', {
            key: `pandit_${panditId}`,
            payload: { channel_id, viewer_count, pandit_id: panditId, profile_id },
        });
        const updatedArr = joined_user_ids.filter(item => item !== user_id);
        for (const user_id of updatedArr) {
            const uid = user_id != null && Number.isFinite(Number(user_id)) ? Number(user_id) : null;

            if (uid != null) {
                callEvent('emit_to_live_viewer_count', {
                    key: `user_${uid}`,
                    payload: { channel_id, viewer_count, pandit_id: panditId, profile_id },
                });
            }
        }
    } catch (e) {
        logger.error('emitLiveViewerCount failed', e?.message, { channel_id, viewer_count });
    }
}

async function readViewerCount(channel_id) {
    const raw = await RedisCache.getCache(LIVE_VIEWER_KEY(channel_id));
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

async function readJoinedUserIds(channel_id) {
    const members = await RedisCache.smembers(LIVE_JOINED_USER_IDS_KEY(channel_id));
    if (!members?.length) return [];
    const nums = members.map((m) => Number(m)).filter((n) => Number.isFinite(n));
    return [...new Set(nums)].sort((a, b) => a - b);
}

/** `emit_to_live_user_joined` — pandit + one socket per joined user id (line by line). */
function emitLiveUserJoinedToEachUser(panditId, channel_id, payload, userId) {
    const base = { pandit_id: panditId, channel_id, ...payload };
    try {
        callEvent('emit_to_live_user_joined', { key: `pandit_${panditId}`, payload: base });
        const updatedArr = payload.joined_user_ids.filter(item => item !== userId);
        console.log("updatedArr", updatedArr);
        for (const user_id of updatedArr) {
            const uid = user_id != null && Number.isFinite(Number(user_id)) ? Number(user_id) : null;
            if (uid != null) {
                callEvent('emit_to_live_user_joined', { key: `user_${uid}`, payload: base });
            }
        }
    } catch (e) {
        logger.error('emitLiveUserJoinedToEachUser failed', e?.message, { channel_id, panditId });
    }
}

function assertAgoraConfig() {
    if (!APP_ID || !APP_CERT) {
        throw new Error('AGORA_NOT_CONFIGURED');
    }
}

function randomViewerUid() {
    let uid;
    do {
        uid = Math.floor(Math.random() * 2_000_000_000) + 1;
    } while (uid === RESERVED_RECORDING_UID);
    return uid;
}

function buildToken(channelId, uid, role) {
    const nowSec = Math.floor(Date.now() / 1000);
    const expire = nowSec + TOKEN_EXPIRE_SECONDS;
    const token = RtcTokenBuilder.buildTokenWithUid(APP_ID, APP_CERT, channelId, uid, role, expire);
    return { token, expire_at: new Date(expire * 1000).toISOString() };
}

/** Real-time: host (pandit room) + viewers (channel room) — same payload as IG live */
function emitLiveChatMessage(panditId, channel_id, payload, userId, joinedUsers) {
    const base = { pandit_id: panditId, channel_id, ...payload };
    try {
        callEvent('emit_to_live_chat_message', { key: `pandit_${panditId}`, payload: base });

        const updatedArr = joinedUsers.filter(item => item !== userId);
        for (const user_id of updatedArr) {
            const uid = user_id != null && Number.isFinite(Number(user_id)) ? Number(user_id) : null;
            if (uid != null) {
                callEvent('emit_to_live_chat_message', { key: `user_${uid}`, payload: base });
            }
        }
    } catch (e) {
        logger.error('emitLiveChatMessage failed', e?.message, payload);
    }
}

function emitcallEnd(panditId, channel_id, userId, joinedUsers) {
    const base = { pandit_id: panditId, channel_id };
    try {
        callEvent('emit_to_private_call_ended', { key: `pandit_${panditId}`, payload: base });

        const updatedArr = joinedUsers.filter(item => item !== userId);
        for (const user_id of updatedArr) {
            const uid = user_id != null && Number.isFinite(Number(user_id)) ? Number(user_id) : null;
            if (uid != null) {
                callEvent('emit_to_private_call_ended', { key: `user_${uid}`, payload: base });
            }
        }
    } catch (e) {
        logger.error('emitcallEnd failed', e?.message, payload);
    }
}

function emitLiveHeart(panditId, channel_id, payload) {
    const base = { pandit_id: panditId, channel_id, ...payload };
    try {
        callEvent('emit_to_live_heart', { key: `pandit_${panditId}`, payload: base });
        callEvent('emit_to_live_heart', { key: `live_channel_${channel_id}`, payload: base });
    } catch (e) {
        logger.error('emitLiveHeart failed', e?.message, payload);
    }
}


/** Instagram-style row: avatar + is_host + keeps DB row fields */
async function enrichLiveChatMessages(rows) {
    if (!rows?.length) return [];
    const userIds = [...new Set(rows.filter((r) => r.sender_type === 'user' && r.sender_id).map((r) => r.sender_id))];
    const panditIds = [...new Set(rows.filter((r) => r.sender_type === 'pandit' && r.sender_id).map((r) => r.sender_id))];
    const usersMap = {};
    const panditsMap = {};
    if (userIds.length) {
        const urows = await db('users').whereIn('id', userIds).select('id', 'profile');
        urows.forEach((u) => {
            usersMap[u.id] = u.profile || null;
        });
    }
    if (panditIds.length) {
        const prows = await db('pandits').whereIn('id', panditIds).select('id', 'profile');
        prows.forEach((p) => {
            panditsMap[p.id] = p.profile || null;
        });
    }
    return rows.map((r) => {
        let sender_profile = null;
        if (r.sender_type === 'user' && r.sender_id) sender_profile = usersMap[r.sender_id] ?? null;
        if (r.sender_type === 'pandit' && r.sender_id) sender_profile = panditsMap[r.sender_id] ?? null;
        return {
            ...r,
            sender_profile,
            is_host: r.sender_type === 'pandit',
        };
    });
}

async function assertLiveChannelActive(channel_id) {
    const live = await db('live_streams').where({ channel_id, status: 'live' }).first();
    return live;
}
const MAX_LIVE_CHAT_LEN = Math.min(Math.max(parseInt(process.env.LIVE_CHAT_MAX_CHARS, 10) || 500, 1), 2000);


/**
 * GET /live-stream/list — active lives + pandit detail + channel_id
 */
async function listLive(req, res) {
    try {
        const rows = await db('live_streams')
            .join('pandits', 'live_streams.pandit_id', 'pandits.id')
            .where('live_streams.status', 'live')
            .select(
                'live_streams.id as live_id',
                'live_streams.channel_id',
                'live_streams.title',
                'live_streams.created_at',
                'live_streams.host_uid',
                'pandits.id as pandit_id',
                'pandits.display_name',
                'pandits.final_chat_call_rate',
                'pandits.profile',
                'pandits.mobile',
                'pandits.country_code',
                'pandits.chat',
                'pandits.call',
                'pandits.online'
            )
            .orderBy('live_streams.created_at', 'desc');

        const pandits = [];
        rows?.map(item => pandits.push(item?.pandit_id));
        const followData = await db('follows').where({ user_id: req.userId }).whereIn('pandit_id', pandits)

        const data = await Promise.all(
            rows.map(async (r) => {
                const isFollow = followData.find(i => i.pandit_id == r.pandit_id);
                return {
                    channel_id: r.channel_id,
                    title: r.title,
                    started_at: r.created_at,
                    viewer_count: await readViewerCount(r.channel_id),
                    pandit: {
                        id: r.pandit_id,
                        display_name: r.display_name,
                        profile: r.profile,
                        mobile: r.mobile,
                        country_code: r.country_code,
                        chat: r.chat,
                        call: r.call,
                        online: r.online,
                        isFollow: !!isFollow,
                        final_chat_call_rate: r.final_chat_call_rate
                    }
                };
            })
        );

        return res.status(200).json({
            success: true,
            data,
            message: 'Live list fetched.',
        });
    } catch (err) {
        logger.error('listLive error', err?.message);
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

/**
 * POST /live-stream/join — rtc token, channel_id, uid (viewer)
 */
async function joinLive(req, res) {
    try {
        assertAgoraConfig();
    } catch {
        return res.status(500).json({ success: false, message: 'Agora is not configured.' });
    }

    const { channel_id } = req.body || {};
    if (!channel_id) {
        return res.status(400).json({ success: false, message: 'channel_id required.' });
    }
    const bodyUserId = req?.userId
    try {
        const live = await db('live_streams').where({ channel_id, status: 'live' }).first();
        if (!live) {
            return res.status(400).json({ success: false, message: 'Live not found or ended.' });
        }

        let joinedUserId = null;
        let joinedUserName = null;
        const u = await db('users').where({ id: Number(bodyUserId) }).first();
        if (u) {
            joinedUserId = Number(u.id);
            joinedUserName = u.name || null;
        }
        const userProfile = await db('userprofiles').where({ user_id: Number(bodyUserId) }).first()
        const uid = randomViewerUid();
        const { token, expire_at } = buildToken(channel_id, uid, RtcRole.SUBSCRIBER);

        const viewer_count = await RedisCache.incr(LIVE_VIEWER_KEY(channel_id));
        if (joinedUserId) {
            await RedisCache.sadd(LIVE_JOINED_USER_IDS_KEY(channel_id), String(joinedUserId));
        }
        const joined_user_ids = await readJoinedUserIds(channel_id);
        console.log("joined_user_ids", joined_user_ids);
        emitLiveViewerCount(live.pandit_id, channel_id, viewer_count, joinedUserId, joined_user_ids, userProfile?.id);
        logger.log('joinLive success', { channel_id, rtc_uid: uid, viewer_count, user_id: joinedUserId });
        emitLiveUserJoinedToEachUser(live.pandit_id, channel_id, {
            user_id: joinedUserId,
            username: joinedUserName ?? u?.name ?? null,
            profile: u?.profile ?? null,
            avatar: u?.avatar ?? null,
            joined_user_ids,
            viewer_count,
            rtc_uid: uid,
            profile_id: userProfile?.id
        }, joinedUserId);
        return res.status(200).json({
            success: true,
            data: {
                app_id: APP_ID,
                channel_id,
                uid,
                token,
                token_expire_at: expire_at,
                viewer_count,
                user_id: joinedUserId,
                user_name: joinedUserName,
                joined_user_ids,
            },
            message: 'Join token created.',
        });
    } catch (err) {
        logger.error('joinLive error', err?.message, { channel_id });
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

/**
 * POST /live-stream/stop (pandit) — end current live (optional cleanup)
 */
async function viewerLeave(req, res) {
    const { channel_id } = req.body || {};
    if (!channel_id) {
        return res.status(400).json({ success: false, message: 'channel_id required.' });
    }

    try {
        const live = await db('live_streams').where({ channel_id, status: 'live' }).first();
        if (!live) {
            return res.status(400).json({ success: false, message: 'Live not found or ended.' });
        }

        const key = LIVE_VIEWER_KEY(channel_id);
        const exists = await RedisCache.getCache(key);
        if (exists == null) {
            return res.status(200).json({
                success: true,
                data: { channel_id, viewer_count: 0 },
                message: 'No viewer counter for this channel.',
            });
        }

        let viewer_count = await RedisCache.decr(key);
        if (viewer_count < 0) {
            await RedisCache.deleteKey(key);
            viewer_count = 0;
        }

        const leftUid = Number(req?.userId);
        if (Number.isFinite(leftUid)) {
            await RedisCache.srem(LIVE_JOINED_USER_IDS_KEY(channel_id), String(leftUid));
        }
        if (viewer_count === 0) {
            await RedisCache.deleteKey(key);
            await RedisCache.deleteKey(LIVE_JOINED_USER_IDS_KEY(channel_id));
        }

        return res.status(200).json({
            success: true,
            data: { channel_id, viewer_count },
            message: 'Viewer left.',
        });
    } catch (err) {
        logger.error('viewerLeave error', err?.message, { channel_id });
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendLiveChatUser(req, res) {
    const { channel_id, message } = req.body || {};
    const text = typeof message === 'string' ? message.trim() : '';
    if (!channel_id || !text) {
        return res.status(400).json({ success: false, message: 'channel_id and message required.' });
    }
    if (text.length > MAX_LIVE_CHAT_LEN) {
        return res.status(400).json({ success: false, message: `Message max ${MAX_LIVE_CHAT_LEN} characters.` });
    }
    const bodyUserId = req.userId

    try {
        const live = await assertLiveChannelActive(channel_id);
        if (!live) {
            return res.status(400).json({ success: false, message: 'Live not found or ended.' });
        }

        let sender_id = null;
        let sender_name = 'Guest';

        const u = await db('users').where({ id: Number(bodyUserId) }).first();
        const profile_id = await db('userprofiles').select('id').where({ user_id: Number(bodyUserId) }).first();
        if (u) {
            sender_id = Number(u.id);
            sender_name = u.name || u.display_name || 'User';
        }

        const [saved] = await db('live_stream_chats')
            .insert({
                channel_id,
                sender_type: 'user',
                sender_id,
                sender_name,
                message: text,
            })
            .returning('*');

        saved.profile = u?.profile
        saved.avatar = u?.avatar
        saved.profile_id = profile_id?.id
        console.log("saved", saved);
        const joined_user_ids = await readJoinedUserIds(channel_id);
        emitLiveChatMessage(live.pandit_id, channel_id, { chat: saved }, bodyUserId, joined_user_ids);

        return res.status(200).json({
            success: true,
            data: saved,
            message: 'Message sent.',
        });
    } catch (err) {
        if (err.code === '42P01') {
            return res.status(500).json({ success: false, message: 'Run migration: live_stream_chats table missing.' });
        }
        logger.error('sendLiveChatUser error', err?.message, { channel_id });
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function sendLiveHeart(req, res) {
    const { channel_id } = req.body || {};
    if (!channel_id) {
        return res.status(400).json({ success: false, message: 'channel_id required.' });
    }

    try {
        const live = await assertLiveChannelActive(channel_id);
        if (!live) {
            return res.status(400).json({ success: false, message: 'Live not found or ended.' });
        }

        const total_hearts = await RedisCache.incr(LIVE_HEARTS_KEY(channel_id));
        emitLiveHeart(live.pandit_id, channel_id, {
            total_hearts,
            at: Date.now(),
        });

        return res.status(200).json({
            success: true,
            data: { channel_id, total_hearts },
            message: 'Heart sent.',
        });
    } catch (err) {
        logger.error('sendLiveHeart error', err?.message, { channel_id });
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function listLiveChat(req, res) {
    const channel_id = req.query.channel_id;
    if (!channel_id) {
        return res.status(400).json({ success: false, message: 'channel_id required.' });
    }

    let page = parseInt(req.query.page, 10) || 1;
    let limit = parseInt(req.query.limit, 10) || 20;

    if (page < 1) page = 1;
    if (limit < 1) limit = 10;
    const offset = (page - 1) * limit;

    try {
        const stream = await db('live_streams').where({ channel_id }).first();
        if (!stream) {
            return res.status(400).json({ success: false, message: 'Channel not found.' });
        }

        const [{ count }] = await db('live_stream_chats').count('* as count').where({ channel_id });
        const rows = await db('live_stream_chats')
            .where({ channel_id })
            .orderBy('id', 'desc')
            .limit(limit)
            .offset(offset);

        const results = await enrichLiveChatMessages(rows);

        const total = parseInt(count, 10);
        const totalPages = Math.ceil(total / limit);

        const response = {
            channel_id,
            page,
            limit,
            total,
            totalPages,
            results,
        };

        return res.status(200).json({
            success: true,
            data: response,
            message: 'Chat list fetched.',
        });
    } catch (err) {
        if (err.code === '42P01') {
            return res.status(500).json({ success: false, message: 'Run migration: live_stream_chats table missing.' });
        }
        logger.error('listLiveChat error', err?.message, { channel_id });
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

/**
 * Same billing / DB rules as POST /order/create, but type must be `audio` or `video`.
 * No socket (callEvent), no push notification, no auto chat messages.
 */
async function createMediaOrder(req, res) {
    const { type, profile_id, pandit_id } = req.body;
    logger.info('order_createMedia', { userId: req.userId, type, profile_id });
    if (!profile_id || !type || !pandit_id) {
        logger.info('order_createMedia fail', { userId: req.userId, message: 'Missing params' });
        return res.status(400).json({ success: false, message: 'Missing params' });
    }
    if (type !== 'audio' && type !== 'video') {
        logger.info('order_createMedia fail', { userId: req.userId, type, message: 'type must be audio or video' });
        return res.status(400).json({ success: false, message: 'type must be audio or video' });
    }
    try {
        const user = await db('users').where({ id: req.userId }).first();
        const continueOrder = await db('orders').where({ user_id: req.userId }).whereIn('status', ['continue', 'pending']).first();
        if (continueOrder?.status === 'continue') {
            logger.info('order_createMedia fail', { userId: req.userId, message: `Please complete your ongoing ${type}.` });
            return res.status(400).json({ success: false, message: `Please complete your ongoing ${type}.` });
        }
        if (continueOrder?.status === 'pending') {
            logger.info('order_createMedia fail', { userId: req.userId, message: `Please reject your pending ${type}.` });
            return res.status(400).json({ success: false, message: `Please reject your pending ${type}.` });
        }

        const pandit = await db('pandits').where({ id: Number(pandit_id) }).first();
        let duration = Math.floor(Number(Number(user?.balance)) / Number(pandit?.final_chat_call_rate));
        let deduction = Number(duration) * Number(pandit?.final_chat_call_rate);
        let rate = pandit?.final_chat_call_rate;

        if (user?.balance < 1) {
            logger.info('order_createMedia fail', { userId: req.userId, message: 'Please recharge your wallet.' });
            return res.status(400).json({ success: false, message: 'Please recharge your wallet.' });
        }
        if (duration < 5) {
            logger.info('order_createMedia fail', { userId: req.userId, message: 'Min. 5 min balance required.' });
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }
        if (Number(user?.balance) < deduction) {
            logger.info('order_createMedia fail', { userId: req.userId, message: 'Min. 5 min balance required.' });
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }

        const orderId = `${new Date().getTime().toString()}${Math.floor(100000 + Math.random() * 900000).toString()}`;
        if (!Number.isFinite(duration)) {
            logger.info('order_createMedia fail', { userId: req.userId, message: 'Min. 5 min balance required.' });
            return res.status(400).json({ success: false, message: 'Min. 5 min balance required.' });
        }
        if (isNaN(deduction)) {
            logger.info('order_createMedia fail', { userId: req.userId, message: 'Balance could not be NaN.' });
            return res.status(400).json({ success: false, message: 'Balance could not be NaN.' });
        }

        const ins = {
            pandit_id: pandit?.id,
            user_id: req.userId,
            order_id: orderId,
            status: 'pending',
            rate,
            duration,
            deduction,
            type,
            profile_id,
            is_free: false,
        };
        const upd = { is_free_order: 'paid' };
        await db('users').where({ id: Number(req.userId) }).update(upd);
        await db('orders').insert(ins).returning('*');
        callEvent('emit_to_live_call_receive', {
            key: `pandit_${pandit?.id}`,
            payload: { order_id: orderId, type, user_id: req.userId, username: user?.name, profile: user?.profile, avatar: user?.avatar },
        });

        const response = await geneateToken(orderId);
        if (!response?.success) {
            return res.status(400).json({ success: false, message: response?.message });
        }
        logger.info('order_createMedia success', { userId: req.userId, orderId, type });
        return res.status(200).json({ success: true, data: { order_id: orderId, ...response?.data }, message: 'Order created successfully' });
    } catch (err) {
        logger.error('order_createMedia error', { userId: req.userId, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function completeOrder(req, res) {
    const { order_id } = req.body || {};
    logger.info('chat_completeOrder', { userId: req.userId, order_id });
    if (!order_id) {
        logger.info('chat_completeOrder fail', { userId: req.userId, message: 'Missing params.' });
        return res.status(400).json({ success: false, message: 'Missing params.' });
    }
    try {
        const order = await db('orders').where({ user_id: req.userId, order_id: order_id }).first();
        if (!order) {
            logger.info('chat_completeOrder fail', { userId: req.userId, order_id, message: 'Wrong order. Please enter correct' });
            return res.status(400).json({ success: false, message: 'Wrong order. Please enter correct' });
        }
        // const diffMinutes = getDuration(order.start_time, new Date());
        const diffMs = Math.abs(new Date() - new Date(order.start_time));
        const totalSeconds = Math.floor(diffMs / 1000);
        const setting = await db('settings').first();
        console.log("totalSeconds", totalSeconds);
        const minSec = setting?.chat_end_min_minutes * 60
        console.log("minSec required", minSec);

        if (order.status == 'pending') {
            logger.info('chat_completeOrder fail', { userId: req.userId, order_id, message: 'order is pending.' });
            return res.status(400).json({ success: false, message: 'order is pending.' });
        }
        if (['cancel', 'rejected'].includes(order.status)) {
            logger.info('chat_completeOrder fail', { userId: req.userId, order_id, message: 'order is rejected.' });
            return res.status(400).json({ success: false, message: 'order is rejected.' });
        }
        if (order.status == 'completed') {
            logger.info('chat_completeOrder fail', { userId: req.userId, order_id, message: 'order is already completed.' });
            return res.status(200).json({ success: false, message: 'order is already completed.' });
        }

        await channelLeave(order_id)
        let now = new Date();
        if (order.end_time) {
            const orderEndTime = new Date(order.end_time);
            if (now > orderEndTime) {
                now = order.end_time
            }
        }
        const result = await balanceCut(req.userId, order, now, "user -> live end");
        if (!result) {
            logger.info('chat_completeOrder fail', { userId: req.userId, order_id, message: 'Something went wrong.' });
            return res.status(400).json({ success: false, message: 'Something went wrong.' });
        }

        callEvent("emit_to_live_call_end", {
            key: `pandit_${order?.pandit_id}`,
            payload: { order_id: order?.order_id }
        });
        //send notify to live 
        const live = await db('live_streams').where({ pandit_id: order?.pandit_id, status: 'live' }).first();
        if (live) {
            const joined_user_ids = await readJoinedUserIds(live?.channel_id);
            emitcallEnd(live.pandit_id, live?.channel_id, req.userId, joined_user_ids);
        }
        logger.info('chat_completeOrder success', { userId: req.userId, order_id });
        return res.status(200).json({ success: true, data: null, message: 'End chat successfully.' });
    } catch (err) {
        logger.error('chat_completeOrder error', { userId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function rejectOrder(req, res) {
    const { order_id } = req.body || {};
    logger.info('order_rejectOrder', { userId: req.userId, order_id });
    try {
        if (!order_id) {
            logger.info('order_rejectOrder fail', { userId: req.userId, message: 'Order id required.' });
            return res.status(400).json({ success: false, message: 'Order id required.' });
        }
        const order = await db('orders').where({ order_id: order_id, user_id: req.userId, status: "pending" }).first();
        if (!order) {
            logger.info('order_rejectOrder fail', { userId: req.userId, order_id, message: 'You can not cancel this order.' });
            return res.status(400).json({ success: false, message: 'You can not cancel this order.' });
        }
        const upd = {}
        let status = 'rejected';
        // if (!order?.is_accept) {
        //     upd.canceled_at = new Date()
        // }
        // if (order?.is_accept) {
        //     status = 'rejected'
        // }
        upd.status = status
        await db('orders').where({ id: order?.id }).update(upd);

        callEvent("emit_to_live_call_reject", {
            key: `pandit_${order?.pandit_id}`,
            order_id: order?.order_id,
        });
        logger.info('order_rejectOrder success', { userId: req.userId, order_id });
        return res.status(200).json({ success: true, message: 'Order cancel Successfully' });
    } catch (err) {
        logger.error('order_rejectOrder error', { userId: req.userId, order_id, err: err?.message });
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function reportUser(req, res) {
    try {
        const { pandit_id, type, reason } = req.body || {};
        if (!pandit_id || !type || !reason) {
            return res.status(400).json({ success: false, message: 'Order id required.' });
        }
        let order = await db('live_reports')
            .where({ pandit_id: pandit_id, type, user_id: req.userId })
            .first();
        if (order) {
            return res.status(400).json({ success: false, message: 'You already reported this user.' });
        }
        await db('live_reports').insert({
            pandit_id, type, user_id: req.userId, reason
        })

        return res.status(200).json({
            success: true,
            data: null,
            message: 'User report Successfully',
        });
    } catch (err) {
        logger.error('acceptAvOrder error', err?.message, { userId: req.userId });
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function stopLive(req, res) {
    const { channel_id } = req.body
    try {
        const active = await db('live_streams').where({ channel_id, status: 'live' }).first();
        if (!active) {
            return res.status(200).json({ success: false, message: 'No active live to stop.' });
        }

        await db('live_streams')
            .where({ channel_id, status: 'live' })
            .update({ status: 'ended', ended_at: db.fn.now() });

        await RedisCache.deleteKey(LIVE_VIEWER_KEY(active.channel_id));
        await RedisCache.deleteKey(LIVE_JOINED_USER_IDS_KEY(active.channel_id));

        logger.log('stopLive success', { channel_id, channel_id: active.channel_id });
        return res.status(200).json({ success: true, data: null, message: 'Live ended.' });
    } catch (err) {
        logger.error('stopLive error', err?.message, { channel_id });
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function checkLive(req, res) {
    const { pandit_id } = req.body
    try {
        const active = await db('orders').where({ pandit_id, status: "continue" }).first();
        if (!active) {
            return res.status(200).json({ success: false, data: null, message: 'No any active call.' });
        }
        return res.status(200).json({ success: true, data: { pandit_id, order_id: active?.order_id, end_time: active?.end_time }, message: 'Live found successful.' });
    } catch (err) {
        logger.error('checkLive error', err?.message);
        console.error(err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = {
    listLive,
    joinLive,
    viewerLeave,
    sendLiveChatUser,
    sendLiveHeart,
    listLiveChat,
    createMediaOrder,
    completeOrder,
    rejectOrder,
    reportUser,
    stopLive,
    readJoinedUserIds,
    emitLiveChatMessage,
    checkLive
};
