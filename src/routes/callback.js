const express = require('express');
const router = express.Router();
const callback = require('../controllers/callbackController');

router.post('/razorpay', callback.razorpay);
router.post('/xpay', callback.xpay);
router.post('/icici', callback.icici);

module.exports = router;
