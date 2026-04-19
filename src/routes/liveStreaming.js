const express = require('express');
const auth = require('../middleware/authMiddleware');
const live = require('../controllers/liveStreamingController');

const router = express.Router();


router.get('/list', live.listLive);
router.post('/join', live.joinLive);
router.post('/leave', live.viewerLeave);
router.post('/sendMessage', live.sendLiveChatUser);
router.get('/chat/list', live.listLiveChat);
router.post('/call/create', live.createMediaOrder);
router.post('/call/reject', live.rejectOrder);
router.post('/call/end', live.completeOrder);
module.exports = router;
