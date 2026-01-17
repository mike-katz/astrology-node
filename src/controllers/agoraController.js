const db = require('../db');
require('dotenv').config();
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");

const APP_ID = process.env.AGORA_APP_ID;
const APP_CERT = process.env.AGORA_APP_CERT;
const axios = require('axios');
const AWS = require('aws-sdk');

const s3 = new AWS.S3({
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
    region: process.env.S3_REGION || 'us-east-1'
});

async function getRtcToken(req, res) {
    try {
        const { channelName } = req.body;

        if (!channelName) {
            return res.status(400).json({ error: 'Channel name is required' });
        }

        const appId = process.env.AGORA_APP_ID;
        const appCertificate = process.env.AGORA_APP_CERTIFICATE;

        if (!appId || !appCertificate) {
            return res.status(500).json({
                error: 'Agora credentials not configured. Please set AGORA_APP_ID and AGORA_APP_CERTIFICATE in .env file'
            });
        }

        // Token expires in 24 hours
        const expirationTimeInSeconds = 3600 * 24;
        const currentTimestamp = Math.floor(Date.now() / 1000);
        const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

        // Generate a random UID between 100000 and 999999 if not provided
        // This ensures uid is never 0 and always unique
        const rtcUid = Math.floor(Math.random() * 900000) + 100000;

        console.log(`Generating token for channel: ${channelName}, UID: ${rtcUid}`);

        // Generate token with publisher role (can publish and subscribe)
        const token = RtcTokenBuilder.buildTokenWithUid(
            appId,
            appCertificate,
            channelName,
            rtcUid,
            RtcRole.PUBLISHER,
            privilegeExpiredTs
        );

        return res.status(200).json({
            success: true, data: {
                token,
                appId,
                uid: rtcUid,
                channelName
            }, message: 'get detail Successfully'
        });
    } catch (error) {
        console.error('Error generating token:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
}

// async function token(req, res) {
//     const { channelName, uid, role = "publisher", expireTime = 3600 } = req.body;

//     if (!channelName || uid === undefined) {
//         return res.status(400).json({ error: "channelName and uid are required" });
//     }

//     const roleEnum = role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;

//     const currentTimestamp = Math.floor(Date.now() / 1000);
//     const privilegeExpireTs = currentTimestamp + expireTime;

//     const token = RtcTokenBuilder.buildTokenWithUid(
//         APP_ID,
//         APP_CERT,
//         channelName,
//         uid,
//         roleEnum,
//         privilegeExpireTs
//     );

//     res.json({ token, appId: APP_ID });
// }

// async function recordingStart(req, res) {
//     try {
//         const { channelName, uid, token } = req.body;

//         if (!channelName || !uid || !token) {
//             return res
//                 .status(400)
//                 .json({ error: "channelName, uid, and token are required" });
//         }

//         // Recording UID - you can use a fixed numeric string, MUST be a string
//         const recordingUid = String(uid); // or "1000", but then token must match that UID

//         // Base URL for cloud recording
//         const baseUrl = `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording`;

//         // Basic auth for Agora RESTful
//         const auth = {
//             username: AGORA_CUSTOMER_ID,
//             password: AGORA_CUSTOMER_CERTIFICATE,
//         };

//         // 1) ACQUIRE
//         const acquirePayload = {
//             cname: channelName,
//             uid: recordingUid,
//             clientRequest: {
//                 resourceExpiredHour: 24, // keep resource for 24h
//             },
//         };

//         const acquireResp = await axios.post(
//             `${baseUrl}/acquire`,
//             acquirePayload,
//             { auth }
//         );

//         const resourceId = acquireResp.data.resourceId;
//         if (!resourceId) {
//             return res.status(500).json({ error: "Failed to acquire resourceId", detail: acquireResp.data });
//         }

//         // 2) START
//         const startPayload = {
//             cname: channelName,
//             uid: recordingUid,
//             clientRequest: {
//                 token: token,

//                 // Recording settings
//                 recordConfig: {
//                     maxIdleTime: 30,              // stop if no users for 30s
//                     streamTypes: 0,               // 0: audio, 1: video, 2: both
//                     channelType: 0,               // 0: communication, 1: live
//                     // videoStreamType: 0,
//                     audioProfile: 1,
//                     // transcodingConfig: {
//                     //     width: 1280,
//                     //     height: 720,
//                     //     fps: 15,
//                     //     bitrate: 1200,
//                     //     mixedVideoLayout: 1,        // 1 = best fit
//                     //     backgroundColor: "#000000",
//                     // },
//                 },

//                 // File & storage settings
//                 recordingFileConfig: {
//                     avFileType: ["hls"],   // choose what you need
//                 },
//                 storageConfig: {
//                     vendor: S3_VENDOR,
//                     region: S3_REGION,
//                     bucket: S3_BUCKET,
//                     accessKey: S3_ACCESS_KEY,
//                     secretKey: S3_SECRET_KEY,
//                     fileNamePrefix: S3_FILE_PATH
//                         ? S3_FILE_PATH.split("/").filter(Boolean)
//                         : [],
//                     // fileNamePrefix: "video/"
//                 },
//             },
//         };


//         const startResp = await axios.post(
//             `${baseUrl}/resourceid/${resourceId}/mode/mix/start`,
//             startPayload,
//             { auth }
//         );

//         const { sid } = startResp.data;

//         if (!sid) {
//             return res.status(500).json({
//                 error: "Failed to start recording",
//                 detail: startResp.data,
//             });
//         }

//         // Return data to frontend
//         return res.json({
//             resourceId,
//             sid,
//             serverResponse: startResp.data,
//         });
//     } catch (err) {
//         console.error("Error in /recording/start:", err?.response?.data || err.message);
//         return res.status(500).json({
//             error: "Internal error while starting recording",
//             detail: err?.response?.data || err.message,
//         });
//     }
// }


// async function recordingStop(req, res) {

//     try {
//         const { resourceId, sid, channelName, uid } = req.body;

//         if (!resourceId || !sid || !channelName || !uid) {
//             return res.status(400).json({
//                 error: "resourceId, sid, channelName and uid are required",
//             });
//         }

//         const recordingUid = String(uid); // must be same UID used in /recording/start

//         const baseUrl = `https://api.agora.io/v1/apps/${APP_ID}/cloud_recording`;

//         const auth = {
//             username: AGORA_CUSTOMER_ID,
//             password: AGORA_CUSTOMER_CERTIFICATE,
//         };

//         // STOP payload is simple
//         const stopPayload = {
//             cname: channelName,
//             uid: recordingUid,
//             clientRequest: {},
//         };

//         const stopResp = await axios.post(
//             `${baseUrl}/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
//             stopPayload,
//             { auth }
//         );

//         // Agora returns file list (e.g., in your S3 bucket)
//         return res.json({
//             serverResponse: stopResp.data,
//         });
//     } catch (err) {
//         console.error("Error in /recording/stop:", err?.response?.data || err.message);
//         return res.status(500).json({
//             error: "Internal error while stopping recording",
//             detail: err?.response?.data || err.message,
//         });
//     }
// }
module.exports = { getRtcToken };