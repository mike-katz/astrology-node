const express = require('express');
const router = express.Router();
const chat = require('../controllers/chatController');

router.get('/rooms', chat.getRoom);
router.get('/messages', chat.getMessage);
router.post('/sendMessage', chat.sendMessage);
router.get('/getDetail', chat.getDetail);
router.get('/getOrderDetail', chat.getOrderDetail);
module.exports = router;