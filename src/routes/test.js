const express = require('express');
const router = express.Router();
const { seedUsers, seedOrders, seedChats, seedPandits } = require('../controllers/testController');

router.get('/seed-users', seedUsers);
router.get('/seed-orders', seedOrders);
router.get('/seed-chats', seedChats);
router.get('/seed-pandits', seedPandits);

module.exports = router;
