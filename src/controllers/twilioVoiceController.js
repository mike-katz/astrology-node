const db = require('../db');
require('dotenv').config();
const twilio = require('twilio');
const S3_BUCKET = process.env.S3_RECORDING_BUCKET || process.env.AWS_BUCKET_NAME;
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY;
const S3_SECRET_KEY = process.env.AWS_SECRET_KEY;
const axios = require('axios');
const aws = require('aws-sdk');
const { uploadToAzure } = require('../utils/azureUploader');

async function voice(req, res) {
    try {
        console.log("here voice api");
        console.log("req.body", req.body);
        console.log("req.queryquery", req.query);
        const { order_id } = req.body
        const VoiceResponse = require('twilio').twiml.VoiceResponse;
        const response = new VoiceResponse();

        const order = await db('orders').where({ order_id }).whereIn('status', ['pending', 'continue']).first();
        if (!order) {
            response.reject();   // 👈 reject call
            return res.type('text/xml').send(response.toString());
            // return res.status(400).json({ success: false, message: 'channelName not found' });
        }
        const nowSec = Math.floor(Date.now() / 1000);
        let endSec;
        if (order.end_time) {
            endSec = Math.floor(new Date(order.end_time).getTime() / 1000);
            if (endSec < nowSec) {
                response.reject();   // 👈 reject call
                return res.type('text/xml').send(response.toString());
                // return { success: true, expireTs: endSec, maxCallSeconds: endSec - nowSec };
            }
        }
        const remainingDuration = endSec - nowSec

        const dial = response.dial({
            timeLimit: remainingDuration,
            record: "record-from-answer",   // 👈 important
            recordingStatusCallback: "https://beta.astroguruji.com/api/voice/recording",
            statusCallback: "https://beta.astroguruji.com/api/voice/status",
            statusCallbackEvent: "initiated ringing answered completed"
        });

        // one-to-one call
        const client = dial.client(req.body.To);
        client.parameter({ name: "order_id", value: order_id });

        res.type('text/xml');
        console.log("response", response);
        res.send(response.toString());
    }
    catch (e) {
        console.log("e", e);
        res.send("something went to wrong");
    }
}

async function generateToken(req, res) {
    try {
        const { user_id = "user_1", order_id } = req.query;
        if (!order_id) return res.status(400).json({ success: false, message: 'channelName required' });

        const order = await db('orders').where({ order_id }).whereIn('status', ['pending', 'continue']).first();
        if (!order) return res.status(400).json({ success: false, message: 'channelName not found' });

        const AccessToken = twilio.jwt.AccessToken;
        const VoiceGrant = AccessToken.VoiceGrant;

        const token = new AccessToken(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_API_KEY_SID,
            process.env.TWILIO_API_KEY_SECRET,
            // { identity: `user_${req.userId}` } // user1, user2
            { identity: user_id } // user1, user2
        );

        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
            incomingAllow: true,
        });

        token.addGrant(voiceGrant);
        return res.status(200).json({ success: true, data: { token: token.toJwt() }, message: 'Token create Successfully' });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}


async function fallback(req, res) {
    console.log("fallback query param", req.query);
    console.log("fallback body param", req.body);
}

async function callback(req, res) {
    console.log("callback query param", req.query);
    console.log("callback body param", req.body);
}

async function recording(req, res) {
    console.log("recording query param", req.query);
    console.log("recording body param", req.body);
    const { RecordingUrl, RecordingSid, CallSid, order_id } = req.body;

    console.log("Recording URL:", RecordingUrl);
    // 🔹 1. Download recording (mp3 format)
    const order = await db('orders').where({ order_id }).first();
    if (order) {
        const response = await axios({
            method: 'GET',
            url: RecordingUrl + '.mp3',
            responseType: 'arraybuffer',
            auth: {
                username: process.env.TWILIO_ACCOUNT_SID,
                password: process.env.TWILIO_AUTH_TOKEN
            }
        });

        const buffer = Buffer.from(response.data);
        const fileName = `recordings/${RecordingSid}_${Date.now()}.mp3`;
        const azureUrl = await uploadToAzure(buffer, fileName);

        const [saved] = await db('chats').insert({
            sender_type: "pandit",
            sender_id: Number(order.pandit_id),
            receiver_type: "user",
            order_id,
            receiver_id: Number(order?.user_id),
            message: fileName,
            status: "send",
            type: "call_recording"
        }).returning('*');
    }
    console.log("Azure URL:", azureUrl);

    // const s3bucket = new aws.S3({
    //     accessKeyId: process.env.AWS_ACCESS_KEY,
    //     secretAccessKey: process.env.AWS_SECRET_KEY,
    // });

    // await s3bucket.upload({
    //     Bucket: S3_BUCKET,
    //     Key: fileName,
    //     Body: fileBuffer,
    //     ContentType: 'audio/mpeg'
    // }).promise();

    // const s3Url = `https://${S3_BUCKET}.s3.amazonaws.com/${fileName}`;

    // console.log("S3 URL:", s3Url);

    // 🔹 3. Save in DB (example Mongo)
    // await db.collection('call_recordings').insertOne({
    //     callSid: CallSid,
    //     recordingSid: RecordingSid,
    //     recordingUrl: s3Url,
    //     createdAt: new Date()
    // });

    // 🔹 4. Delete from Twilio
    // const twilio = require('twilio')(
    //     process.env.TWILIO_ACCOUNT_SID,
    //     process.env.TWILIO_AUTH_TOKEN
    // );

    // await twilio.recordings(RecordingSid).remove();

    console.log("Deleted from Twilio");

    res.sendStatus(200);

}

async function completedStatus(req, res) {
    console.log("completedStatus called", req.body);
    const { CallStatus, CallDuration, order_id } = req.body;
    if (CallStatus === "completed") {
        // await db.collection('orders').
    }
}

module.exports = { voice, generateToken, fallback, callback, recording, completedStatus };
