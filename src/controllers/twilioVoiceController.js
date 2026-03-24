const db = require('../db');
require('dotenv').config();
const twilio = require('twilio');
const S3_BUCKET = process.env.S3_RECORDING_BUCKET || process.env.AWS_BUCKET_NAME;
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY;
const S3_SECRET_KEY = process.env.AWS_SECRET_KEY;

async function voice(req, res) {
    try {
        console.log("here voice api");
        console.log("req.body", req.body);
        console.log("req.queryquery", req.query);
        const VoiceResponse = require('twilio').twiml.VoiceResponse;
        const response = new VoiceResponse();

        const dial = response.dial({
            record: "record-from-answer",   // 👈 important
            recordingStatusCallback: "https://beta.astroguruji.com/api/voice/recording"
        });

        // one-to-one call
        dial.client(req.body.To);

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
        const { user_id = "user_1" } = req.query
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

    const { RecordingUrl, RecordingSid, CallSid } = req.body;

    console.log("Recording URL:", RecordingUrl);

    // 🔹 1. Download recording (mp3 format)


    const response = await axios({
        method: 'GET',
        url: RecordingUrl + '.mp3',
        responseType: 'arraybuffer',
        auth: {
            username: process.env.TWILIO_ACCOUNT_SID,
            password: process.env.TWILIO_AUTH_TOKEN
        }
    });

    const fileBuffer = Buffer.from(response.data, 'binary');

    // 🔹 2. Upload to S3
    const fileName = `recordings/${CallSid}_${Date.now()}.mp3`;

    await s3.upload({
        Bucket: S3_BUCKET,
        Key: fileName,
        Body: fileBuffer,
        ContentType: 'audio/mpeg'
    }).promise();

    const s3Url = `https://${S3_BUCKET}.s3.amazonaws.com/${fileName}`;

    console.log("S3 URL:", s3Url);

    // 🔹 3. Save in DB (example Mongo)
    await db.collection('call_recordings').insertOne({
        callSid: CallSid,
        recordingSid: RecordingSid,
        recordingUrl: s3Url,
        createdAt: new Date()
    });

    // 🔹 4. Delete from Twilio
    const twilio = require('twilio')(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );

    await twilio.recordings(RecordingSid).remove();

    console.log("Deleted from Twilio");

    res.sendStatus(200);

}


module.exports = { voice, generateToken, fallback, callback, recording };
