const twilio = require('twilio');
require('dotenv').config();

async function sendTwilioSMS(to, message) {
    const client = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
    );

    const payload = {
        body: message,
        to,
    };

    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
        payload.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else {
        payload.from = process.env.TWILIO_PHONE_NUMBER;
    }

    return client.messages.create(payload);
}

module.exports = { sendTwilioSMS };
