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

const getAgoraRegionCode = (awsRegion) => {
    const regionMap = {
        'us-east-1': 1,      // US East (N. Virginia)
        'us-east-2': 2,      // US East (Ohio)
        'us-west-1': 3,      // US West (N. California)
        'us-west-2': 4,      // US West (Oregon)
        'eu-west-1': 5,      // Europe (Ireland)
        'eu-central-1': 6,   // Europe (Frankfurt)
        'ap-southeast-1': 7, // Asia Pacific (Singapore)
        'ap-northeast-1': 8, // Asia Pacific (Tokyo)
        'ap-southeast-2': 9, // Asia Pacific (Sydney)
        'ap-south-1': 10,    // Asia Pacific (Mumbai)
        'ca-central-1': 11,  // Canada (Central)
        'sa-east-1': 12      // South America (São Paulo)
    };
    return regionMap[awsRegion?.toLowerCase()] || 1; // Default to US East 1
};


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

async function recordingStart(req, res) {
    try {
        const { channelName, uid, token } = req.body;

        // Check for null/undefined explicitly (uid can be 0 which is falsy but valid)
        if (!channelName || uid == null || !token) {
            return res.status(400).json({
                error: 'channelName, uid, and token are required',
                received: { channelName, uid, hasToken: !!token }
            });
        }

        const appId = process.env.AGORA_APP_ID;
        const customerKey = process.env.AGORA_CUSTOMER_KEY;
        const customerSecret = process.env.AGORA_CUSTOMER_SECRET;
        const s3BucketName = process.env.AWS_BUCKET_NAME;
        const s3AccessKey = process.env.AWS_ACCESS_KEY;
        const s3SecretKey = process.env.AWS_SECRET_KEY;
        const s3Region = process.env.S3_REGION || 'us-east-1';
        const agoraRegionCode = getAgoraRegionCode(s3Region);

        if (!appId || !customerKey || !customerSecret) {
            return res.status(500).json({
                error: 'Agora recording credentials not configured. Please set AGORA_CUSTOMER_KEY and AGORA_CUSTOMER_SECRET in .env file'
            });
        }

        // Validate S3 credentials before starting recording
        if (!s3BucketName || !s3AccessKey || !s3SecretKey) {
            return res.status(500).json({
                error: 'S3 credentials not configured for recording upload. Please set S3_BUCKET_NAME, S3_ACCESS_KEY, and S3_SECRET_KEY in .env file',
                missing: {
                    bucket: !s3BucketName,
                    accessKey: !s3AccessKey,
                    secretKey: !s3SecretKey
                }
            });
        }

        // Acquire resource
        const acquireResponse = await axios.post(
            `https://api.agora.io/v1/apps/${appId}/cloud_recording/acquire`,
            {
                cname: channelName,
                uid: String(uid),
                clientRequest: {
                    resourceExpiredHour: 24
                }
            },
            {
                auth: {
                    username: customerKey,
                    password: customerSecret
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const resourceId = acquireResponse.data.resourceId;

        // Start recording
        const startResponse = await axios.post(
            `https://api.agora.io/v1/apps/${appId}/cloud_recording/resourceid/${resourceId}/mode/mix/start`,
            {
                cname: channelName,
                uid: String(uid),
                clientRequest: {
                    token: token,
                    recordingConfig: {
                        maxIdleTime: 30,
                        streamTypes: 2, // Audio only
                        audioProfile: 1,
                        channelType: 0
                    },
                    recordingFileConfig: {
                        avFileType: ['hls'] // HLS format is supported for mix mode recording (audio-only)
                    },
                    storageConfig: {
                        vendor: 1, // Amazon S3
                        region: agoraRegionCode, // Dynamically mapped from S3_REGION env variable
                        bucket: s3BucketName,
                        accessKey: s3AccessKey,
                        secretKey: s3SecretKey
                    }
                }
            },
            {
                auth: {
                    username: customerKey,
                    password: customerSecret
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('Recording started successfully:', {
            resourceId,
            sid: startResponse.data.sid,
            bucket: s3BucketName,
            region: s3Region,
            agoraRegionCode: agoraRegionCode,
            serverResponse: startResponse.data.serverResponse
        });

        res.json({
            resourceId,
            sid: startResponse.data.sid,
            serverResponse: startResponse.data.serverResponse,
            message: 'Recording started. Files will be uploaded to S3 when recording stops.',
            s3Bucket: s3BucketName
        });
    } catch (error) {
        console.error('❌ Error starting recording:', error.response?.data || error.message);

        // Log detailed error information
        if (error.response?.data) {
            console.error('Error details:', JSON.stringify(error.response.data, null, 2));

            // Check for S3 configuration errors
            if (error.response.data.message && error.response.data.message.includes('storage')) {
                console.error('⚠️ S3 Storage Configuration Error - Please check:');
                console.error('  - S3_BUCKET_NAME:', s3BucketName ? 'Set ✓' : 'Missing ✗');
                console.error('  - S3_ACCESS_KEY:', s3AccessKey ? 'Set ✓' : 'Missing ✗');
                console.error('  - S3_SECRET_KEY:', s3SecretKey ? 'Set ✓' : 'Missing ✗');
                console.error('  - S3_REGION:', s3Region, '(Agora code:', agoraRegionCode + ')');
            }
        }

        res.status(500).json({
            error: 'Failed to start recording',
            details: error.response?.data || error.message
        });
    }
}

async function recordingStop(req, res) {
    try {
        const { resourceId, sid, channelName, uid } = req.body;

        // Check for null/undefined explicitly (uid can be 0 which is falsy but valid)
        if (!resourceId || !sid || !channelName || uid == null) {
            return res.status(400).json({
                error: 'resourceId, sid, channelName, and uid are required',
                received: { resourceId: !!resourceId, sid: !!sid, channelName, uid }
            });
        }

        const appId = process.env.AGORA_APP_ID;
        const customerKey = process.env.AGORA_CUSTOMER_KEY;
        const customerSecret = process.env.AGORA_CUSTOMER_SECRET;

        if (!appId || !customerKey || !customerSecret) {
            return res.status(500).json({
                error: 'Agora recording credentials not configured'
            });
        }

        const stopResponse = await axios.post(
            `https://api.agora.io/v1/apps/${appId}/cloud_recording/resourceid/${resourceId}/sid/${sid}/mode/mix/stop`,
            {
                cname: channelName,
                uid: String(uid),
                clientRequest: {}
            },
            {
                auth: {
                    username: customerKey,
                    password: customerSecret
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const serverResponse = stopResponse.data.serverResponse;

        // Log file information if available
        if (serverResponse?.fileList) {
            console.log('📁 Recording files uploaded to S3:');
            serverResponse.fileList.forEach((file, index) => {
                console.log(`  File ${index + 1}:`, {
                    fileName: file.fileName,
                    fileType: file.fileType,
                    fileSize: file.fileSize,
                    trackType: file.trackType,
                    uid: file.uid,
                    mixType: file.mixType
                });
            });
        } else if (serverResponse?.uploadingStatus) {
            console.log('📤 Recording upload status:', serverResponse.uploadingStatus);
        }

        console.log('✅ Recording stopped. Full response:', JSON.stringify(serverResponse, null, 2));

        res.json({
            success: true,
            serverResponse: serverResponse,
            message: 'Recording stopped successfully. Files are being uploaded to S3.',
            fileList: serverResponse?.fileList || []
        });
    } catch (error) {
        console.error('❌ Error stopping recording:', error.response?.data || error.message);

        if (error.response?.data) {
            console.error('Stop recording error details:', JSON.stringify(error.response.data, null, 2));
        }

        res.status(500).json({
            error: 'Failed to stop recording',
            details: error.response?.data || error.message
        });
    }
}

module.exports = { getRtcToken, recordingStart, recordingStop };