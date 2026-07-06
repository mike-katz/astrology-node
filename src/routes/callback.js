const express = require('express');
const router = express.Router();
const callback = require('../controllers/callbackController');

router.post('/razorpay', callback.razorpay);
router.post('/xpay', callback.xpay);
router.post('/icici', callback.icici);
router.post('/twilio/sms', callback.twilioSms);

module.exports = router;
