const express = require('express');
const router = express.Router();
const twilio = require('../controllers/twilioVoiceController');

router.get('/token', twilio.generateToken);

module.exports = router;
