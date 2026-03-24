/**
 * Twilio Voice TwiML demos — patterns from
 * https://www.twilio.com/docs/voice/twiml
 *
 * Point a Twilio number "A call comes in" URL to any of these (POST).
 * For <Gather action="..."> set TWILIO_PUBLIC_BASE_URL.
 */

const path = require('path');
const twilio = require('twilio');
const logger = require('log4js').getLogger(path.parse(__filename).name);

const VoiceResponse = twilio.twiml.VoiceResponse;

function sendVoiceXml(res, vr) {
    res.type('text/xml');
    return res.send(vr.toString());
}

/** Public base URL, no trailing slash (e.g. https://xxx.ngrok.io or https://host/api) */
function getPublicBaseUrl() {
    const raw = process.env.TWILIO_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '';
    return String(raw).trim().replace(/\/$/, '') || null;
}

/**
 * GET /twilio/voice/twiml — JSON index (not TwiML); for developers only.
 */
function twimlDemoIndex(req, res) {
    const base = req.protocol && req.get('host') ? `${req.protocol}://${req.get('host')}` : '';
    return res.json({
        success: true,
        message: 'TwiML demo routes (Voice). Point a Twilio number or TwiML App Voice URL here.',
        docs: 'See docs/TWIML_DEMO.md',
        twilioReference: 'https://www.twilio.com/docs/voice/twiml',
        note: 'Twilio sends POST (application/x-www-form-urlencoded). GET works for quick browser/XML peek.',
        publicBaseConfigured: Boolean(getPublicBaseUrl()),
        endpoints: {
            hello: `${base}/twilio/voice/twiml/hello`,
            say: `${base}/twilio/voice/twiml/say?text=Your+message`,
            pause: `${base}/twilio/voice/twiml/pause`,
            gather: `${base}/twilio/voice/twiml/gather`,
            gatherCallback: `${base}/twilio/voice/twiml/gather-callback`,
            reject: `${base}/twilio/voice/twiml/reject`,
            outboundDial: `${base}/twilio/voice/outbound-twiml (existing; Voice SDK connect)`,
        },
    });
}

/**
 * Classic "Hello world" — <Say> then hang up.
 * https://www.twilio.com/docs/voice/twiml/say
 */
function twimlHello(req, res) {
    const vr = new VoiceResponse();
    vr.say({ voice: 'alice', language: 'en-US' }, 'Hello from Astro TwiML demo. Goodbye.');
    return sendVoiceXml(res, vr);
}

/**
 * Say custom text — query ?text=... or POST body Text (Voice SDK custom params often uppercase).
 */
function twimlSay(req, res) {
    const vr = new VoiceResponse();
    const text =
        req.query.text ||
        req.body?.Text ||
        req.body?.text ||
        'No text parameter. Add question mark text equals your message.';
    const safe = String(text).slice(0, 500);
    vr.say({ voice: 'alice', language: 'en-IN' }, safe);
    return sendVoiceXml(res, vr);
}

/**
 * <Pause> then <Say> — https://www.twilio.com/docs/voice/twiml/pause
 */
function twimlPause(req, res) {
    const vr = new VoiceResponse();
    vr.say({ voice: 'alice' }, 'Please wait.');
    const len = Math.min(Math.max(parseInt(req.query.length || req.body?.length || '2', 10) || 2, 1), 10);
    vr.pause({ length: len });
    vr.say({ voice: 'alice' }, 'Thanks for waiting. Goodbye.');
    return sendVoiceXml(res, vr);
}

/**
 * <Gather> DTMF — https://www.twilio.com/docs/voice/twiml/gather
 * Requires TWILIO_PUBLIC_BASE_URL for action URL.
 */
function twimlGather(req, res) {
    const vr = new VoiceResponse();
    const base = getPublicBaseUrl();
    if (!base) {
        vr.say(
            { voice: 'alice' },
            'Gather demo needs T W L I O underscore P U B L I C underscore B A S E underscore U R L in server environment.'
        );
        return sendVoiceXml(res, vr);
    }

    const action = `${base}/twilio/voice/twiml/gather-callback`;
    const gather = vr.gather({
        input: 'dtmf',
        numDigits: 1,
        timeout: 5,
        action,
        method: 'POST',
    });
    gather.say(
        { voice: 'alice' },
        'Welcome to the gather demo. Press 1 for option one, or 2 for option two.'
    );
    vr.say({ voice: 'alice' }, "We didn't receive any input. Goodbye.");
    return sendVoiceXml(res, vr);
}

/**
 * Second leg after <Gather> — reads Digits from POST body.
 */
function twimlGatherCallback(req, res) {
    const vr = new VoiceResponse();
    const digits = (req.body && req.body.Digits) || '';
    logger.info('twimlGatherCallback', { digits: digits || '(none)' });

    if (digits === '1') {
        vr.say({ voice: 'alice' }, 'You selected option one. Thank you.');
    } else if (digits === '2') {
        vr.say({ voice: 'alice' }, 'You selected option two. Thank you.');
    } else if (digits) {
        vr.say({ voice: 'alice' }, `You pressed ${digits}. Thank you.`);
    } else {
        vr.say({ voice: 'alice' }, 'No digit received.');
    }
    return sendVoiceXml(res, vr);
}

/**
 * <Reject> — https://www.twilio.com/docs/voice/twiml/reject
 */
function twimlReject(req, res) {
    const vr = new VoiceResponse();
    const reason = ['rejected', 'busy'].includes(String(req.query.reason || '').toLowerCase())
        ? String(req.query.reason).toLowerCase()
        : 'rejected';
    vr.reject({ reason });
    return sendVoiceXml(res, vr);
}

/**
 * Optional: log call progress (set as Status Callback URL on a Twilio number).
 * https://www.twilio.com/docs/voice/twiml#call-status-values
 */
function twimlStatusCallback(req, res) {
    logger.info('twimlStatusCallback', {
        CallSid: req.body?.CallSid,
        CallStatus: req.body?.CallStatus,
        From: req.body?.From,
        To: req.body?.To,
    });
    res.type('text/xml');
    return res.send(new VoiceResponse().toString());
}

module.exports = {
    twimlDemoIndex,
    twimlHello,
    twimlSay,
    twimlPause,
    twimlGather,
    twimlGatherCallback,
    twimlReject,
    twimlStatusCallback,
    getPublicBaseUrl,
};
