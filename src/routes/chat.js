const express = require('express');
const router = express.Router();
const chat = require('../controllers/chatController');

router.get('/rooms', chat.getRoom);
router.get('/messages', chat.getMessage);
module.exports = router;