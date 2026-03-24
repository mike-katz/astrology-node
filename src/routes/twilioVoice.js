const express = require('express');
const router = express.Router();
const twilio = require('../controllers/twilioVoiceController');

router.post('/', twilio.voice);
router.post('/fallback', twilio.fallback);
router.post('/callback', twilio.callback);

module.exports = router;
