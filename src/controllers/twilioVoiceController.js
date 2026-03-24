const path = require('path');
const twilio = require('twilio');
const logger = require('log4js').getLogger(path.parse(__filename).name);
const {
    generateTwilioVoiceToken,
    decodeJwtPayload,
    useStaticTest,
    getActiveVoiceRegion,
    getVoiceClientHints,
} = require('../utils/twilioVoiceToken');

/**
 * GET /twilio/voice/token
 * Twilio Voice Access Token (JWT) for Voice SDK.
 *
 * Query:
 *   userId (required if no auth) – numeric/string id for identity user_<id> or pandit_<id>
 *   role=user|pandit
 *   ttl=seconds (60–86400, default from env or 3600)
 *   twimlAppSid=AP... – optional override
 */
async function getVoiceAccessToken(req, res) {
    try {
        const userId = req.userId ?? req.query.userId;
        if (userId == null || userId === '') {
            return res.status(401).json({ success: false, message: 'Unauthorized or missing userId' });
        }

        const role = req.query.role;
        const roleNorm = String(role || 'user').toLowerCase();
        const identity =
            roleNorm === 'pandit' ? `pandit_${userId}` : `user_${userId}`;

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
                voiceRegionInToken: getActiveVoiceRegion(),
                clientHints: getVoiceClientHints(),
            },
            message: 'Twilio Voice token issued',
        });
    } catch (err) {
        if (err.code === 'TWILIO_CONFIG_MISSING' || err.code === 'TWILIO_CONFIG_INVALID') {
            logger.error('Twilio Voice config', err.message);
            return res.status(503).json({
                success: false,
                message: err.message,
            });
        }
        logger.error('getVoiceAccessToken error', err);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
}

/**
 * GET /twilio/voice/static-test-token
 * Only when TWILIO_STATIC_TEST=true — fixed identity static_test_user, uses TWILIO_STATIC_* in code + optional .env overrides for SDK flag.
 * Response includes decoded JWT payload (for debug) and token string for Voice SDK.
 */
async function getStaticTestToken(req, res) {
    if (!useStaticTest()) {
        return res.status(404).json({
            success: false,
            message: 'Set TWILIO_STATIC_TEST=true in .env to enable this endpoint',
        });
    }
    try {
        const identity = 'static_test_user';
        const token = await generateTwilioVoiceToken(identity, {
            ttlSeconds: 3600,
        });
        const payload = decodeJwtPayload(token);
        return res.status(200).json({
            success: true,
            message:
                'Static test token. Paste data.token into Voice SDK. If still invalid, set TWILIO_JWT_USE_SDK=true or fix API Key Secret for this SK in Twilio Console.',
            data: {
                token,
                identity,
                voiceRegionInToken: getActiveVoiceRegion(),
                clientHints: getVoiceClientHints(),
                jwtParts: token.split('.').length,
                payloadPreview: payload
                    ? {
                        iss: payload.iss,
                        sub: payload.sub,
                        exp: payload.exp,
                        grantsKeys: payload.grants ? Object.keys(payload.grants) : [],
                    }
                    : null,
            },
        });
    } catch (err) {
        if (err.code === 'TWILIO_CONFIG_INVALID' || err.code === 'TWILIO_CONFIG_MISSING') {
            return res.status(503).json({ success: false, message: err.message });
        }
        logger.error('getStaticTestToken', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
}

/**
 * POST /twilio/voice/outbound-twiml
 * Twilio TwiML App — Voice request URL (outbound from Voice JS SDK).
 * Client calls device.connect({ params: { To: '+1…' } }); Twilio POSTs those params here.
 *
 * Env: TWILIO_CALLER_ID — verified Twilio number (E.164), required for Dial callerId.
 */
function outboundTwiml(req, res) {
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const vr = new VoiceResponse();

    const To = (req.body && req.body.To) || req.query.To;
    const dest = To != null ? String(To).trim() : '';

    if (!dest) {
        vr.say({ voice: 'alice' }, 'No destination number was provided.');
        res.type('text/xml');
        return res.send(vr.toString());
    }

    const callerId =
        process.env.TWILIO_CALLER_ID ||
        process.env.TWILIO_FROM_NUMBER ||
        process.env.TWILIO_PHONE_NUMBER;

    if (!callerId || !String(callerId).trim()) {
        logger.warn('outboundTwiml: missing TWILIO_CALLER_ID');
        vr.say(
            { voice: 'alice' },
            'Server is not configured with a caller I D. Set TWILIO_CALLER_ID in environment.'
        );
        res.type('text/xml');
        return res.send(vr.toString());
    }

    try {
        const dial = vr.dial({
            callerId: String(callerId).trim(),
            answerOnBridge: true,
        });
        dial.number(dest);
        res.type('text/xml');
        return res.send(vr.toString());
    } catch (e) {
        logger.error('outboundTwiml dial error', e);
        const errVr = new VoiceResponse();
        errVr.say({ voice: 'alice' }, 'Could not start the call.');
        res.type('text/xml');
        return res.send(errVr.toString());
    }
}

module.exports = { getVoiceAccessToken, getStaticTestToken, outboundTwiml };
