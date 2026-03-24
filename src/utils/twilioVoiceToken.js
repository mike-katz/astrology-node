/**
 * Twilio Voice Access Token (JWT).
 *
 * Default signing: official Twilio helper (same as Twilio quickstart):
 *   const AccessToken = require('twilio').jwt.AccessToken;
 *   const VoiceGrant = AccessToken.VoiceGrant;
 *   token.addGrant(new VoiceGrant({ outgoingApplicationSid, incomingAllow: true }));
 *   token.toJwt();
 *
 * Env (Twilio doc names supported):
 *   TWILIO_ACCOUNT_SID, TWILIO_API_KEY (SK…), TWILIO_API_SECRET
 *   or TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET
 *   TWILIO_TWIML_APP_SID (AP…)
 *
 * Fallback: TWILIO_JWT_USE_MANUAL=true → manual crypto.createHmac (if SDK conflicts with jsonwebtoken).
 * TWILIO_JWT_USE_SDK=false → same as manual (legacy).
 *
 * Static test: TWILIO_STATIC_TEST=true — uses TWILIO_STATIC_* below; remove before production.
 */

const crypto = require('crypto');
const twilio = require('twilio');

/** Set TWILIO_STATIC_TEST=true in .env to use these for quick connectivity test only */

function useStaticTest() {
    return false;
}

/** Prefer Twilio's AccessToken.toJwt() unless manual path requested. */
function useSdkJwt() {
    if (String(process.env.TWILIO_JWT_USE_MANUAL || '').toLowerCase() === 'true') {
        return false;
    }
    if (String(process.env.TWILIO_JWT_USE_SDK || '').toLowerCase() === 'false') {
        return false;
    }
    return true;
}

/** @type {{ sid: string, secret: string } | null} */
let cachedApiKey = null;
let credentialsValidated = false;

function cleanEnv(value) {
    if (value == null) return '';
    let s = String(value).trim();
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

function getAccountSid() {
    if (useStaticTest()) return TWILIO_STATIC.accountSid;
    return cleanEnv(process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_SID);
}

function getAuthToken() {
    return cleanEnv(process.env.TWILIO_AUTH_TOKEN);
}

function getTwimlAppSid() {
    if (useStaticTest()) return TWILIO_STATIC.twimlAppSid;
    return cleanEnv(process.env.TWILIO_TWIML_APP_SID || process.env.TWILIO_APPLICATION_SID);
}

function getRegion() {
    return cleanEnv(process.env.TWILIO_REGION || process.env.TWILIO_VOICE_REGION);
}

function getPushCredentialSid() {
    return cleanEnv(process.env.TWILIO_VOICE_PUSH_CREDENTIAL_SID);
}

/** Region embedded in JWT header (twr). Null = SDK should use default edge (usually US). */
function getActiveVoiceRegion() {
    const r = getRegion();
    return r || null;
}

/** Hints for Flutter / web Voice SDK — error 53000 is signaling/WebSocket, not JWT parsing. */
function getVoiceClientHints() {
    const r = getActiveVoiceRegion();
    return {
        regionMustMatchSdk:
            r != null
                ? `JWT includes region (twr). Configure Voice SDK edge/region to the SAME value (e.g. ${r}). Mismatch → ConnectionError 53000.`
                : 'JWT has no twr — use Voice SDK default edge. Do not force a random edge.',
        ifConnectionError53000: [
            '53000 = signaling WebSocket failed (network/firewall/VPN), not “wrong password” on JWT',
            'Try Wi‑Fi vs mobile data; turn off VPN / corporate proxy',
            'If .env has TWILIO_REGION=sg1|ie1|us1, client MUST use matching edge',
            'India: often try TWILIO_REGION=sg1 on server + Singapore edge on app',
            'Allow wss:// to Twilio (firewall); iOS: VoIP background + ATS',
        ],
    };
}

function normalizeApiKeyPair(sidRaw, secretRaw) {
    let sid = cleanEnv(sidRaw);
    let secret = cleanEnv(secretRaw);
    if (!sid || !secret) return { sid, secret };

    const sidLooksLikeKey = sid.startsWith('SK') && sid.length >= 32;
    const secretLooksLikeKey = secret.startsWith('SK') && secret.length >= 32;

    if (!sidLooksLikeKey && secretLooksLikeKey) {
        return { sid: secret, secret: sid };
    }
    return { sid, secret };
}

async function resolveSigningCredentials() {
    if (useStaticTest()) {
        return {
            sid: TWILIO_STATIC.apiKeySid,
            secret: TWILIO_STATIC.apiKeySecret,
        };
    }

    // Twilio quickstart: TWILIO_API_KEY + TWILIO_API_SECRET; also TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET
    let explicitSid =
        cleanEnv(process.env.TWILIO_API_KEY_SID) || cleanEnv(process.env.TWILIO_API_KEY);
    let explicitSecret =
        cleanEnv(process.env.TWILIO_API_KEY_SECRET) || cleanEnv(process.env.TWILIO_API_SECRET);
    if (explicitSid && explicitSecret) {
        const normalized = normalizeApiKeyPair(explicitSid, explicitSecret);
        if (!normalized.sid.startsWith('SK')) {
            const err = new Error(
                'TWILIO_API_KEY_SID must start with SK. Secret must be the one shown once for that key.'
            );
            err.code = 'TWILIO_CONFIG_INVALID';
            throw err;
        }
        if (normalized.secret.length < 8) {
            const err = new Error('TWILIO_API_KEY_SECRET too short after trim');
            err.code = 'TWILIO_CONFIG_INVALID';
            throw err;
        }
        return { sid: normalized.sid, secret: normalized.secret };
    }

    const accountSid = getAccountSid();
    const authToken = getAuthToken();
    if (!accountSid || !authToken) {
        const err = new Error(
            'Set TWILIO_STATIC_TEST=true OR full env (AC/SK/secret/AP) or ACCOUNT_SID+AUTH_TOKEN'
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

function skipCredentialVerify() {
    return String(process.env.TWILIO_SKIP_CREDENTIAL_VERIFY || '').toLowerCase() === 'true';
}

/**
 * Proves SK + Secret work for this Account (Twilio REST). Fails with 401 if Secret wrong or SK/AC mismatch.
 * Set TWILIO_SKIP_CREDENTIAL_VERIFY=true only for local debug (not production).
 */
async function assertCredentialsWork(accountSid, apiKeySid, apiKeySecret) {
    if (credentialsValidated) return;
    if (skipCredentialVerify()) {
        credentialsValidated = true;
        return;
    }
    const client = twilio(apiKeySid, apiKeySecret, { accountSid });
    try {
        await client.api.accounts(accountSid).fetch();
    } catch (e) {
        const twilioCode = e?.code;
        const twilioMsg = e?.message || String(e);
        const hint = [
            'Twilio REST auth failed (often 20003 / "Authenticate"). Check:',
            `1) TWILIO_ACCOUNT_SID=${accountSid?.slice(0, 6)}… must be the SAME Twilio project that owns this API Key.`,
            '2) TWILIO_API_KEY (or TWILIO_API_KEY_SID) must be the Key SID starting with SK…',
            '3) TWILIO_API_SECRET (or TWILIO_API_KEY_SECRET) must be that key\'s Secret (shown once in Console) — NOT the Account Auth Token.',
            '4) If unsure: Console → Account → API keys & tokens → Create API Key → copy SK + Secret into .env immediately.',
            '5) Optional: remove explicit API key env vars so the app creates a key using TWILIO_AUTH_TOKEN (Account SID + Auth Token).',
            '6) Dev only: TWILIO_SKIP_CREDENTIAL_VERIFY=true skips this check (JWT may still fail on device if creds are wrong).',
        ].join('\n');
        const err = new Error(`${twilioMsg}${twilioCode != null ? ` (Twilio code ${twilioCode})` : ''}\n${hint}`);
        err.code = 'TWILIO_CONFIG_INVALID';
        throw err;
    }
    credentialsValidated = true;
}

function sanitizeIdentity(identity) {
    return String(identity).replace(/[^a-zA-Z0-9_.@-]/g, '_').slice(0, 128);
}

function b64url(objOrStr) {
    const s = typeof objOrStr === 'string' ? objOrStr : JSON.stringify(objOrStr);
    return Buffer.from(s, 'utf8')
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

/** Manual JWT — header key order aligned with typical JWT libs: alg, typ, cty, twr */
function signVoiceAccessTokenManual({
    accountSid,
    apiKeySid,
    apiKeySecret,
    identity,
    ttlSeconds,
    outgoingApplicationSid,
    incomingAllow,
    pushCredentialSid,
    region,
}) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;

    const voice = {};
    if (incomingAllow) {
        voice.incoming = { allow: true };
    }
    if (outgoingApplicationSid) {
        voice.outgoing = { application_sid: outgoingApplicationSid };
    }
    if (pushCredentialSid) {
        voice.push_credential_sid = pushCredentialSid;
    }

    const header = {
        alg: 'HS256',
        typ: 'JWT',
        cty: 'twilio-fpa;v=1',
    };
    if (region) {
        header.twr = region;
    }

    const payload = {
        jti: `${apiKeySid}-${now}`,
        iss: apiKeySid,
        sub: accountSid,
        iat: now,
        exp,
        grants: {
            identity: String(identity),
            voice,
        },
    };

    const h = b64url(header);
    const p = b64url(payload);
    const sig = crypto
        .createHmac('sha256', apiKeySecret)
        .update(`${h}.${p}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    return `${h}.${p}.${sig}`;
}

/** Official Twilio Node signer (uses bundled jsonwebtoken) */
function signVoiceAccessTokenSdk({
    accountSid,
    apiKeySid,
    apiKeySecret,
    identity,
    ttlSeconds,
    outgoingApplicationSid,
    incomingAllow,
    pushCredentialSid,
    region,
}) {
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const opts = {
        identity: String(identity),
        ttl: ttlSeconds,
    };
    if (region) opts.region = region;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, opts);

    const vg = {
        outgoingApplicationSid,
        incomingAllow: incomingAllow !== false,
    };
    if (pushCredentialSid) vg.pushCredentialSid = pushCredentialSid;
    token.addGrant(new VoiceGrant(vg));

    return token.toJwt();
}

async function generateTwilioVoiceToken(identity, options = {}) {
    const accountSid = getAccountSid();
    const outgoingApplicationSid =
        options.outgoingApplicationSid || getTwimlAppSid();

    if (!accountSid) {
        const err = new Error('Missing TWILIO_ACCOUNT_SID');
        err.code = 'TWILIO_CONFIG_MISSING';
        throw err;
    }
    if (!accountSid.startsWith('AC')) {
        const err = new Error('TWILIO_ACCOUNT_SID must start with AC');
        err.code = 'TWILIO_CONFIG_INVALID';
        throw err;
    }
    if (!outgoingApplicationSid || !outgoingApplicationSid.startsWith('AP')) {
        const err = new Error('Missing or invalid TWILIO_TWIML_APP_SID (AP…)');
        err.code = 'TWILIO_CONFIG_MISSING';
        throw err;
    }

    const cleanIdentity = sanitizeIdentity(identity);
    if (!cleanIdentity) {
        const err = new Error('Invalid identity');
        err.code = 'TWILIO_IDENTITY_INVALID';
        throw err;
    }

    const { sid: apiKeySid, secret: apiKeySecret } = await resolveSigningCredentials();

    try {
        await assertCredentialsWork(accountSid, apiKeySid, apiKeySecret);
    } catch (e) {
        if (e.code === 'TWILIO_CONFIG_INVALID') throw e;
        const err = new Error(
            `API Key + Secret do not match this Account (Twilio REST failed). Detail: ${e.message}`
        );
        err.code = 'TWILIO_CONFIG_INVALID';
        throw err;
    }

    const ttl = Math.min(
        Math.max(
            Number(options.ttlSeconds) ||
            Number(cleanEnv(process.env.TWILIO_VOICE_TOKEN_TTL_SECONDS)) ||
            3600,
            60
        ),
        86400
    );

    const region = getRegion() || undefined;
    const incomingAllow = options.incomingAllow !== false;
    const pushSid = getPushCredentialSid() || undefined;

    const args = {
        accountSid,
        apiKeySid,
        apiKeySecret,
        identity: cleanIdentity,
        ttlSeconds: ttl,
        outgoingApplicationSid,
        incomingAllow,
        pushCredentialSid: pushSid,
        region,
    };

    try {
        if (useSdkJwt()) {
            return signVoiceAccessTokenSdk(args);
        }
        return signVoiceAccessTokenManual(args);
    } catch (e) {
        const err = new Error(`Twilio JWT sign failed: ${e.message}`);
        err.code = 'TWILIO_JWT_SIGN_FAILED';
        throw err;
    }
}

/**
 * Decode payload only (debug) — do not use for security decisions.
 */
function decodeJwtPayload(jwt) {
    const parts = String(jwt).split('.');
    if (parts.length !== 3) return null;
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
        'utf8'
    );
    try {
        return JSON.parse(json);
    } catch {
        return null;
    }
}

module.exports = {
    generateTwilioVoiceToken,
    decodeJwtPayload,
    useStaticTest,
    getActiveVoiceRegion,
    getVoiceClientHints,
};
