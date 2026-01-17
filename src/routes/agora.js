const express = require('express');
const router = express.Router();
const agora = require('../controllers/agoraController');

router.post('/rtc-token', agora.getRtcToken);
// router.post('/token', agora.token);
router.post('/recording/start', agora.recordingStart);
router.post('/recording/stop', agora.recordingStop);

module.exports = router;