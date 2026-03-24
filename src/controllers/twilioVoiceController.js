const db = require('../db');
require('dotenv').config();
const twilio = require('twilio');

async function voice(req, res) {
    try {
        console.log("here voice api");
        console.log("req.body", req.body);
        console.log("req.queryquery", req.query);
        const VoiceResponse = require('twilio').twiml.VoiceResponse;
        const response = new VoiceResponse();

        const dial = response.dial();

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

        const AccessToken = twilio.jwt.AccessToken;
        const VoiceGrant = AccessToken.VoiceGrant;

        const token = new AccessToken(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_API_KEY,
            process.env.TWILIO_API_SECRET,
            { identity: `user_${req.userId}` } // user1, user2
        );

        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: process.env.TWIML_APP_SID,
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


module.exports = { voice, generateToken, fallback, callback };
