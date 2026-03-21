/**
 * Twilio Programmable Voice – Access Token (JWT) for Voice SDK clients.
 * @see https://www.twilio.com/docs/voice/sdks#requirements
 *
 * Test / simple setup (2 env vars):
 *   TWILIO_ACCOUNT_SID (or TWILIO_SID)
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_TWIML_APP_SID – TwiML App SID (AP…) for outgoing Voice SDK calls
 *
 * On first token request, an API Key is created via REST (Auth Token) and cached
 * in memory for this process (Voice JWTs must be signed with an API Key, not Auth Token).
 *
 * Production (optional – avoids creating keys on each deploy):
 *   TWILIO_API_KEY_SID
 *   TWILIO_API_KEY_SECRET
 *
 * Optional: TWILIO_VOICE_TOKEN_TTL_SECONDS (default 3600, max 86400)
 */

const twilio = require('twilio');

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

/** @type {{ sid: string, secret: string } | null} */
let cachedApiKey = null;

function getAccountSid() {
    return process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID || '';
}

function getAuthToken() {
    return process.env.TWILIO_AUTH_TOKEN || '';
}

function getTwimlAppSid() {
    return process.env.TWILIO_TWIML_APP_SID || process.env.TWILIO_APPLICATION_SID || '';
}

/**
 * Resolve API Key SID + secret: explicit env, or create once with Account SID + Auth Token.
 */
async function resolveSigningCredentials() {
    const explicitSid = process.env.TWILIO_API_KEY_SID;
    const explicitSecret = process.env.TWILIO_API_KEY_SECRET;
    if (explicitSid && explicitSecret) {
        return { sid: explicitSid, secret: explicitSecret };
    }

    const accountSid = getAccountSid();
    const authToken = getAuthToken();
    if (!accountSid || !authToken) {
        const err = new Error(
            'Set TWILIO_ACCOUNT_SID (or TWILIO_SID) and TWILIO_AUTH_TOKEN, or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET'
        );
        err.code = 'TWILIO_CONFIG_MISSING';
        throw err;
    }

    if (cachedApiKey) return cachedApiKey;

    const client = twilio(accountSid, authToken);
    const key = await client.keys.create({
        friendlyName: `voice-sdk-${Date.now()}`,
    });
    cachedApiKey = { sid: key.sid, secret: key.secret };
    return cachedApiKey;
}

/**
 * @param {string} identity
 * @param {object} [options]
 * @param {number} [options.ttlSeconds]
 * @param {boolean} [options.incomingAllow]
 * @param {string} [options.outgoingApplicationSid] – override TwiML App SID (e.g. from query in tests)
 * @returns {Promise<string>} JWT
 */
async function generateTwilioVoiceToken(identity, options = {}) {
    const accountSid = getAccountSid();
    const outgoingApplicationSid =
        options.outgoingApplicationSid || getTwimlAppSid();

    if (!accountSid) {
        const err = new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_SID');
        err.code = 'TWILIO_CONFIG_MISSING';
        throw err;
    }
    if (!outgoingApplicationSid) {
        const err = new Error(
            'Missing TWILIO_TWIML_APP_SID (TwiML App SID for Voice outgoing – starts with AP)'
        );
        err.code = 'TWILIO_CONFIG_MISSING';
        throw err;
    }

    if (!identity || typeof identity !== 'string' || identity.length > 128) {
        const err = new Error('Invalid identity for Twilio Voice token');
        err.code = 'TWILIO_IDENTITY_INVALID';
        throw err;
    }

    const { sid: apiKeySid, secret: apiKeySecret } = await resolveSigningCredentials();

    const ttl = Math.min(
        Math.max(
            Number(options.ttlSeconds) ||
                Number(process.env.TWILIO_VOICE_TOKEN_TTL_SECONDS) ||
                3600,
            60
        ),
        86400
    );

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
        identity,
        ttl,
    });

    const voiceGrant = new VoiceGrant({
        outgoingApplicationSid,
        incomingAllow: options.incomingAllow !== false,
    });
    token.addGrant(voiceGrant);

    return token.toJwt();
}

module.exports = { generateTwilioVoiceToken };
