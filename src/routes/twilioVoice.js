const express = require('express');
const router = express.Router();
const {
    getVoiceAccessToken,
    getStaticTestToken,
    outboundTwiml,
} = require('../controllers/twilioVoiceController');
const {
    twimlDemoIndex,
    twimlHello,
    twimlSay,
    twimlPause,
    twimlGather,
    twimlGatherCallback,
    twimlReject,
    twimlStatusCallback,
} = require('../controllers/twilioTwimlDemoController');

/** Twilio webhooks send application/x-www-form-urlencoded */
const urlencoded = express.urlencoded({ extended: false });

router.get('/token', getVoiceAccessToken);
router.get('/static-test-token', getStaticTestToken);
router.post('/outbound-twiml', urlencoded, outboundTwiml);

/** TwiML demos — GET/POST (Twilio uses POST) */
router.get('/twiml', twimlDemoIndex);
router.all('/twiml/hello', urlencoded, twimlHello);
router.all('/twiml/say', urlencoded, twimlSay);
router.all('/twiml/pause', urlencoded, twimlPause);
router.all('/twiml/gather', urlencoded, twimlGather);
router.all('/twiml/gather-callback', urlencoded, twimlGatherCallback);
router.all('/twiml/reject', urlencoded, twimlReject);
router.all('/twiml/status-callback', urlencoded, twimlStatusCallback);

module.exports = router;
