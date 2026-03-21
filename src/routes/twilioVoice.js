const express = require('express');
const router = express.Router();
const { getVoiceAccessToken } = require('../controllers/twilioVoiceController');

router.get('/token', getVoiceAccessToken);

module.exports = router;
