const express = require('express');
const router = express.Router();
const callback = require('../controllers/callbackController');

router.post('/razorpay', callback.razorpay);
router.post('/twilio', callback.twilio);

module.exports = router;
