const express = require('express');
const router = express.Router();
const chat = require('../controllers/chatController');

router.post('/order/reject', chat.rejectAgoraCall);
router.post('/order/complete', chat.completedAgoraCall);

module.exports = router;