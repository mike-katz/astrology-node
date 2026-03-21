const path = require('path');
const logger = require('log4js').getLogger(path.parse(__filename).name);
const { generateTwilioVoiceToken } = require('../utils/twilioVoiceToken');

/**
 * GET /twilio/voice/token
 * Twilio Voice Access Token (JWT) for Voice SDK.
 *
 * Env (test): TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_TWIML_APP_SID
 * Query (optional):
 *   role=user|pandit
 *   ttl=seconds
 *   twimlAppSid=AP...  – override TwiML App SID for this request only
 */
async function getVoiceAccessToken(req, res) {
    try {
        const userId = req.userId;
        if (userId == null) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const role = String(req.query.role || 'user').toLowerCase();
        const identity =
            role === 'pandit' ? `pandit_${userId}` : `user_${userId}`;

        let ttlSeconds = parseInt(req.query.ttl, 10);
        if (Number.isNaN(ttlSeconds)) ttlSeconds = undefined;

        const twimlOverride =
            typeof req.query.twimlAppSid === 'string' && req.query.twimlAppSid.startsWith('AP')
                ? req.query.twimlAppSid
                : undefined;

        const token = await generateTwilioVoiceToken(identity, {
            ttlSeconds,
            outgoingApplicationSid: twimlOverride,
        });

        return res.status(200).json({
            success: true,
            data: {
                token,
                identity,
            },
            message: 'Twilio Voice token issued',
        });
    } catch (err) {
        if (err.code === 'TWILIO_CONFIG_MISSING') {
            logger.error('Twilio Voice config missing', err.message);
            return res.status(503).json({
                success: false,
                message: err.message || 'Voice service not configured on server',
            });
        }
        logger.error('getVoiceAccessToken error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

module.exports = { getVoiceAccessToken };
