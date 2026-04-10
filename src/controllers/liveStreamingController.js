const crypto = require('crypto');
const db = require('../db');
const RedisCache = require('../config/redisClient');
const { callEvent } = require('../socket');
const logger = require('../utils/logger').getLogger('liveStreamingController');
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');

require('dotenv').config();

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERT = process.env.AGORA_APP_CERTIFICATE;
const TOKEN_EXPIRE_SECONDS = parseInt(process.env.AGORA_LIVE_TOKEN_EXPIRE_SECONDS, 10) || 86400;
const RESERVED_RECORDING_UID = 999999;

const LIVE_VIEWER_KEY = (channelId) => `live_stream:viewers:${channelId}`;

function emitLiveViewerCount(panditId, channel_id, viewer_count) {
    try {
        callEvent('emit_to_live_viewer_count', {
            key: `pandit_${panditId}`,
            payload: { channel_id, viewer_count, pandit_id: panditId },
        });
    } catch (e) {
        logger.error('emitLiveViewerCount failed', e?.message, { channel_id, viewer_count });
    }
}

function emitLiveViewerJoined(panditId, payload) {
    try {
        callEvent('emit_to_live_viewer_joined', {
            key: `pandit_${panditId}`,
            payload: { pandit_id: panditId, ...payload },
        });
    } catch (e) {
        logger.error('emitLiveViewerJoined failed', e?.message, payload);
    }
}

async function readViewerCount(channel_id) {
    const raw = await RedisCache.getCache(LIVE_VIEWER_KEY(channel_id));
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
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
function emitLiveChatMessage(panditId, channel_id, payload) {
    const base = { pandit_id: panditId, channel_id, ...payload };
    try {
        callEvent('emit_to_live_chat_message', { key: `pandit_${panditId}`, payload: base });
        callEvent('emit_to_live_chat_message', { key: `live_channel_${channel_id}`, payload: base });
    } catch (e) {
        logger.error('emitLiveChatMessage failed', e?.message, payload);
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
async function listLive(_req, res) {
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
                'pandits.name',
                'pandits.profile',
                'pandits.mobile',
                'pandits.country_code',
                'pandits.chat',
                'pandits.call',
                'pandits.online'
            )
            .orderBy('live_streams.created_at', 'desc');

        const data = await Promise.all(
            rows.map(async (r) => ({
                channel_id: r.channel_id,
                title: r.title,
                started_at: r.created_at,
                viewer_count: await readViewerCount(r.channel_id),
                pandit: {
                    id: r.pandit_id,
                    display_name: r.display_name,
                    name: r.name,
                    profile: r.profile,
                    mobile: r.mobile,
                    country_code: r.country_code,
                    chat: r.chat,
                    call: r.call,
                    online: r.online,
                },
            }))
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
            return res.status(404).json({ success: false, message: 'Live not found or ended.' });
        }

        let joinedUserId = null;
        let joinedUserName = null;
        const u = await db('users').where({ id: Number(bodyUserId) }).first();
        if (u) {
            joinedUserId = Number(u.id);
            joinedUserName = u.name || u.display_name || null;
        }

        const uid = randomViewerUid();
        const { token, expire_at } = buildToken(channel_id, uid, RtcRole.SUBSCRIBER);

        const viewer_count = await RedisCache.incr(LIVE_VIEWER_KEY(channel_id));
        emitLiveViewerCount(live.pandit_id, channel_id, viewer_count);
        emitLiveViewerJoined(live.pandit_id, {
            channel_id,
            rtc_uid: uid,
            user_id: joinedUserId,
            user_name: joinedUserName,
            viewer_count,
        });

        logger.log('joinLive success', { channel_id, rtc_uid: uid, viewer_count, user_id: joinedUserId });

        callEvent("emit_to_live_user_joined", {
            key: `pandit_${live?.pandit_id}`,
            payload: { user_id: u.id, username: u.username, profile: u.profile }
        });
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
            return res.status(404).json({ success: false, message: 'Live not found or ended.' });
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
        if (viewer_count === 0) {
            await RedisCache.deleteKey(key);
        }

        emitLiveViewerCount(live.pandit_id, channel_id, viewer_count);
        logger.log('viewerLeave', { channel_id, viewer_count });

        callEvent("emit_to_live_user_left", {
            key: `pandit_${live?.pandit_id}`,
            payload: { user_id: req?.userId, channel_id }
        });
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
            return res.status(404).json({ success: false, message: 'Live not found or ended.' });
        }

        let sender_id = null;
        let sender_name = 'Guest';
        if (bodyUserId != null && bodyUserId !== '') {
            const u = await db('users').where({ id: Number(bodyUserId) }).first();
            if (u) {
                sender_id = Number(u.id);
                sender_name = u.name || u.display_name || 'User';
            }
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

        const [enriched] = await enrichLiveChatMessages([saved]);
        emitLiveChatMessage(live.pandit_id, channel_id, { chat: enriched });

        return res.status(200).json({
            success: true,
            data: enriched,
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
            return res.status(404).json({ success: false, message: 'Live not found or ended.' });
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
            return res.status(404).json({ success: false, message: 'Channel not found.' });
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

module.exports = {
    listLive,
    joinLive,
    viewerLeave,
    sendLiveChatUser,
    sendLiveHeart,
    listLiveChat
};
