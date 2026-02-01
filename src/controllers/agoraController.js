const axios = require('axios');
const db = require('../db');
const RedisCache = require('../config/redisClient');

require('dotenv').config();
const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const { callEvent } = require('../socket');

/* ================= ENV ================= */
const APP_ID = process.env.AGORA_APP_ID;
const APP_CERT = process.env.AGORA_APP_CERTIFICATE;
const CUSTOMER_KEY = process.env.AGORA_CUSTOMER_KEY;
const CUSTOMER_SECRET = process.env.AGORA_CUSTOMER_SECRET;

// AWS S3 (Agora vendor 4)
const S3_BUCKET = process.env.S3_RECORDING_BUCKET || process.env.AWS_BUCKET_NAME;
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY;
const S3_SECRET_KEY = process.env.AWS_SECRET_KEY;
const S3_REGION = process.env.AWS_REGION || 'ap-south-1';  // e.g. ap-south-1 for Mumbai

/* ================= CONSTANT ================= */
// 🔑 Dedicated recording bot UID
const RECORDING_UID = 111111;
// Dynamic recording: start when 2+ users, stop when < 2
const RECORDING_MODE = 'mix';
const MIN_USERS_TO_START_RECORDING = 2;
const CHANNEL_COUNT_KEY = (cname) => `agora:channel:${cname}:count`;
const CHANNEL_RECORDING_KEY = (cname) => `agora:channel:${cname}:recording`;
// Max call time: default 5 min (fallback when order has no duration)
const DEFAULT_MAX_CALL_SECONDS = parseInt(process.env.AGORA_DEFAULT_MAX_CALL_SECONDS, 10) || 60;

/* =====================================================
   Get token expire & max call seconds for order (order_id = channelName)
   When token expires, Agora AUTO-REMOVES user from channel (no API call needed)
   - order.end_time (if future) → absolute expire (both user+pandit same time)
   - order.call_minutes / max_minutes / minutes → now + minutes
   - default 5 min
   Returns: { expireTs, maxCallSeconds }
   ===================================================== */
async function getTokenExpireForOrder(channelName) {
    const nowSec = Math.floor(Date.now() / 1000);
    const order = await db('orders').where({ order_id: channelName }).first();
    if (!order) {
        return { expireTs: nowSec + DEFAULT_MAX_CALL_SECONDS, maxCallSeconds: DEFAULT_MAX_CALL_SECONDS };
    }

    // end_time = absolute max call end (use same expire for both user & pandit)
    if (order.end_time) {
        const endSec = Math.floor(new Date(order.end_time).getTime() / 1000);
        if (endSec > nowSec) {
            return { expireTs: endSec, maxCallSeconds: endSec - nowSec };
        }
    }

    // call_minutes, max_minutes, minutes = purchased minutes
    const minutes = order.call_minutes ?? order.max_minutes ?? order.minutes;
    if (minutes != null && Number(minutes) > 0) {
        const sec = Math.min(Number(minutes) * 60, 3600);
        return { expireTs: nowSec + sec, maxCallSeconds: sec };
    }

    return { expireTs: nowSec + DEFAULT_MAX_CALL_SECONDS, maxCallSeconds: DEFAULT_MAX_CALL_SECONDS };
}

/* =====================================================
   1️⃣ getRtcToken
   input  : channelName (order_id)
   output : token + uid + maxCallSeconds (+ join done: if 2nd user → recording starts)
   Each order can have different max call time (e.g. 2 min, 5 min)
   Token create thay tyare join thay; 2 users thay to recording auto-start
   ===================================================== */
async function getRtcToken(req, res) {
    try {
        const { channelName } = req.body;
        if (!channelName) {
            return res.status(400).json({ message: 'channelName required' });
        }

        // 👤 frontend user UID (random)
        const uid = Math.floor(Math.random() * 900000) + 100000;

        // Order-wise max call time - when token expires, Agora auto-disconnects user (no API needed)
        const { expireTs, maxCallSeconds } = await getTokenExpireForOrder(channelName);
        console.log("maxCallSeconds", maxCallSeconds);
        const nowSec = Math.floor(Date.now() / 1000);
        const expire = maxCallSeconds < 60 ? nowSec + 60 : expireTs; // min 1 min validity
        const actualMaxCallSeconds = expire - nowSec;
        console.log("expire", expire);
        console.log("actualMaxCallSeconds", actualMaxCallSeconds);
        const token = RtcTokenBuilder.buildTokenWithUid(
            APP_ID,
            APP_CERT,
            channelName,
            uid,
            RtcRole.PUBLISHER,
            expire
        );

        // Token create = join count; 2 users thay to recording start
        const countKey = CHANNEL_COUNT_KEY(channelName);
        const recordingKey = CHANNEL_RECORDING_KEY(channelName);
        const newCount = await RedisCache.incr(countKey);
        let recordingStarted = false;
        if (newCount === MIN_USERS_TO_START_RECORDING) {
            try {
                const { resourceId, sid } = await startRecordingForChannel(channelName);
                await RedisCache.setCache(recordingKey, JSON.stringify({ resourceId, sid }), 86400);
                recordingStarted = true;
                console.log(`[Agora] recording auto-started for channel ${channelName} (2 users)`);
            } catch (err) {
                console.error('[Agora] auto start recording failed', err.response?.data || err.message);
                await RedisCache.decr(countKey);
            }
        }

        return res.json({
            success: true,
            data: {
                appId: APP_ID,
                channelName,
                uid,
                token,
                userCount: newCount,
                recordingStarted,
                maxCallSeconds: actualMaxCallSeconds  // frontend: show timer; Agora auto-ends call when token expires
            }
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'token generation failed' });
    }
}

/* ================= RECORDING REQUEST BODY ================= */
const recordingStartBody = (channelName, recordingToken) => ({
    cname: channelName,
    uid: String(RECORDING_UID),
    clientRequest: {
        token: recordingToken,
        recordingConfig: {
            channelType: 0,
            streamTypes: 0,        // ✅ AUDIO ONLY
            streamMode: "original",
            audioProfile: 1,
            maxIdleTime: 30,
            // transcodingConfig: null
        },
        recordingFileConfig: {
            avFileType: ['hls']
        },
        storageConfig: {
            vendor: 1,           // 4 = AWS S3
            region: 14,
            bucket: S3_BUCKET,
            accessKey: S3_ACCESS_KEY,
            secretKey: S3_SECRET_KEY,
            fileNamePrefix: ['recordings', channelName]
        },
        async_stop: false
    }
});

/* ================= INTERNAL HELPERS (dynamic recording) ================= */
async function startRecordingForChannel(channelName) {
    const expire = Math.floor(Date.now() / 1000) + 3600;
    const recordingToken = RtcTokenBuilder.buildTokenWithUid(
        APP_ID,
        APP_CERT,
        channelName,
        RECORDING_UID,
        RtcRole.SUBSCRIBER,
        expire
    );
    const acquireRes = await axios.post(
        `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/acquire`,
        {
            cname: channelName,
            uid: String(RECORDING_UID),
            clientRequest: { resourceExpiredHour: 24 }
        },
        { auth: { username: CUSTOMER_KEY, password: CUSTOMER_SECRET } }
    );
    const resourceId = acquireRes.data.resourceId;
    const startRes = await axios.post(
        `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/mode/${RECORDING_MODE}/start`,
        recordingStartBody(channelName, recordingToken),
        { auth: { username: CUSTOMER_KEY, password: CUSTOMER_SECRET } }
    );
    return { resourceId, sid: startRes.data.sid };
}

async function stopRecordingForChannel(channelName, resourceId, sid) {

    console.log("channelName, resourceId, sid", channelName, resourceId, sid);
    await axios.post(
        `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/${RECORDING_MODE}/stop`,
        {
            cname: channelName,
            uid: String(RECORDING_UID),
            clientRequest: {}
        },
        { auth: { username: CUSTOMER_KEY, password: CUSTOMER_SECRET } }
    );
}

/* =====================================================
   channelLeave – call when user leaves channel
   When only 1 user left → recording stops automatically
   body: channelName, uid
   ===================================================== */
async function channelLeave(channelName) {
    try {
        if (!channelName) {
            return { status: false, message: 'channelName and uid required' };
        }
        const countKey = CHANNEL_COUNT_KEY(channelName);
        const recordingKey = CHANNEL_RECORDING_KEY(channelName);
        const newCount = await RedisCache.decr(countKey);
        let recordingStopped = false;
        if (newCount === 1) {
            const recJson = await RedisCache.getCache(recordingKey);
            console.log("recJson", recJson);
            if (recJson) {
                try {
                    const { resourceId, sid } = JSON.parse(recJson);
                    await stopRecordingForChannel(channelName, resourceId, sid);
                    recordingStopped = true;
                    console.log(`[Agora] recording auto-stopped for channel ${channelName} (1 user left)`);
                } catch (err) {
                    if (err.response?.data?.code !== 435) {
                        console.error('[Agora] auto stop recording failed', err.response?.data || err.message);
                    }
                }
                await RedisCache.deleteKey(recordingKey);
            }
        }
        if (newCount <= 0) {
            await RedisCache.deleteKey(countKey);
        }
        return {
            success: true,
            data: { userCount: Math.max(0, newCount), recordingStopped }
        };
    } catch (err) {
        console.error(err);
        return { success: false, message: 'channel leave failed' };
    }
}

/* =====================================================
   2️⃣ recordingStart (mix / composite mode)
   input : channelName, uid, token
   ===================================================== */
async function recordingStart(req, res) {
    return _recordingStart(req, res, 'mix');
}

/* =====================================================
   2b️⃣ recordingStartIndividual (individual mode - per user)
   input : channelName, uid, token
   ===================================================== */
async function recordingStartIndividual(req, res) {
    return _recordingStart(req, res, 'individual');
}

async function _recordingStart(req, res, mode) {
    try {
        const { channelName, uid, token } = req.body;

        if (!channelName || uid == null || !token) {
            return res.status(400).json({ message: 'channelName, uid, token required' });
        }

        const expire = Math.floor(Date.now() / 1000) + 3600;
        const recordingToken = RtcTokenBuilder.buildTokenWithUid(
            APP_ID,
            APP_CERT,
            channelName,
            RECORDING_UID,
            RtcRole.SUBSCRIBER,
            expire
        );

        const acquireRes = await axios.post(
            `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/acquire`,
            {
                cname: channelName,
                uid: String(RECORDING_UID),
                clientRequest: { resourceExpiredHour: 24 }
            },
            { auth: { username: CUSTOMER_KEY, password: CUSTOMER_SECRET } }
        );

        const resourceId = acquireRes.data.resourceId;
        const startRes = await axios.post(
            `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/mode/${mode}/start`,
            recordingStartBody(channelName, recordingToken),
            { auth: { username: CUSTOMER_KEY, password: CUSTOMER_SECRET } }
        );

        console.log(`recording start (${mode})`, startRes?.data);
        return res.json({
            success: true,
            data: {
                resourceId,
                sid: startRes.data.sid,
                mode,
                message: 'Recording started successfully'
            }
        });
    } catch (err) {
        console.error(err.response?.data || err.message);
        return res.status(500).json({ message: 'recording start failed' });
    }
}

/* =====================================================
   3️⃣ recordingStop (mix mode)
   input : resourceId, sid, channelName, uid
   ===================================================== */
async function recordingStop(req, res) {
    return _recordingStop(req, res, 'mix');
}

/* =====================================================
   3b️⃣ recordingStopIndividual (individual mode)
   input : resourceId, sid, channelName, uid
   ===================================================== */
async function recordingStopIndividual(req, res) {
    return _recordingStop(req, res, 'individual');
}

async function _recordingStop(req, res, mode) {
    try {
        const { resourceId, sid, channelName, uid } = req.body;

        if (!resourceId || !sid || !channelName || uid == null) {
            return res.status(400).json({
                message: 'resourceId, sid, channelName, uid required'
            });
        }

        const stopRes = await axios.post(
            `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/${mode}/stop`,
            {
                cname: channelName,
                uid: String(RECORDING_UID),
                clientRequest: {}
            },
            { auth: { username: CUSTOMER_KEY, password: CUSTOMER_SECRET } }
        );
        console.log(`recording stop (${mode})`, JSON.stringify(stopRes?.data));
        return res.json({
            success: true,
            data: {
                message: 'Recording stopped',
                mode,
                response: stopRes.data
            }
        });
    } catch (err) {
        if (err.response?.data?.code === 435) {
            return res.json({ message: 'No recorded data (safe exit)' });
        }
        console.error(err.response?.data || err.message);
        return res.status(500).json({ message: 'recording stop failed' });
    }
}

/* =====================================================
   4️⃣ recordingWebhook (Agora Notifications)
   Agora POSTs to this URL for recording events.
   Must return 200 + JSON within 10 seconds.

   Events handled:
   - eventType 31 → recording.uploaded (all files uploaded to S3)
   - eventType 11 → recording.completed (session_exit - recording service ended)
   ===================================================== */
async function recordingWebhook(req, res) {
    try {
        const { noticeId, productId, eventType, notifyMs, payload } = req.body || {};

        console.log("recordingWebhook body", JSON.stringify(req.body));
        if (!payload) {
            return res.status(200).json({ ok: true, message: 'ignored' });
        }

        // console.log("webhook start", JSON.stringify(req.body));
        const { cname, uid, sid, sequence, sendts, serviceType, details } = payload;

        // eventType 31 = uploaded (recording.uploaded)
        if (eventType === 31) {
            const msgName = details?.msgName || 'uploaded';
            const fileList = details?.fileList || [];
            console.log('[Agora Webhook] recording.uploaded', {
                noticeId,
                cname,
                sid,
                status: details?.status,
                fileCount: fileList.length,
                fileList: fileList.map(f => f.fileName)
            });

            const order = await db('orders').where({ order_id: cname }).first();
            console.log("order", order);
            if (order) {
                const bucketName = process.env.AWS_BUCKET_NAME;
                console.log("fileList[0].fileName", fileList[0].fileName);
                const [saved] = await db('chats').insert({
                    sender_type: "pandit",
                    sender_id: Number(order.pandit_id),
                    // sender_id: Number(1),
                    receiver_type: "user",
                    order_id: cname,
                    receiver_id: Number(order?.user_id),
                    message: `https://${bucketName}.s3.amazonaws.com/${fileList[0].fileName}`,
                    status: "send",
                    type: "call_recording"
                }).returning('*');
                console.log("saved", saved);

                console.log("socket start");
                callEvent("emit_to_user", {
                    toType: "user",
                    toId: order?.user_id,
                    orderId: order?.order_id,
                    payload: saved,
                });
                callEvent("emit_to_user", {
                    toType: "pandit",
                    toId: order?.pandit_id,
                    orderId: order?.order_id,
                    payload: saved,
                });
                console.log("socket end");

            }
            // TODO: e.g. save recording URLs to DB, notify user, etc.
        }

        // eventType 11 = session_exit (recording.completed)
        if (eventType === 11) {
            const exitStatus = details?.exitStatus;
            console.log('[Agora Webhook] recording.completed (session_exit)', {
                noticeId,
                cname,
                sid,
                exitStatus: exitStatus === 0 ? 'normal' : 'abnormal'
            });
            // TODO: e.g. mark call as recorded, update order status, etc.
        }

        // Agora expects 200 OK + JSON within 10 seconds
        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('[Agora Webhook] error', err);
        // Still return 200 so Agora doesn't retry
        return res.status(200).json({ ok: true });
    }
}

/* ================= EXPORT ================= */
module.exports = {
    getRtcToken,
    channelLeave,
    recordingStart,
    recordingStop,
    recordingStartIndividual,
    recordingStopIndividual,
    recordingWebhook
};
