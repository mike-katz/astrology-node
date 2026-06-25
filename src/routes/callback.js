const express = require('express');
const router = express.Router();
const callback = require('../controllers/callbackController');

router.post('/razorpay', callback.razorpay);
router.post('/xpay', callback.xpay);

module.exports = router;
