const express = require('express');
const auth = require('../middleware/authMiddleware');
const live = require('../controllers/liveStreamingController');

const router = express.Router();


router.get('/list', live.listLive);
router.post('/join', live.joinLive);
router.post('/leave', live.viewerLeave);
router.post('/sendMessage', live.sendLiveChatUser);
router.get('/chat/list', live.listLiveChat);
module.exports = router;
