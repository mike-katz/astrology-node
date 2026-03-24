const express = require('express');
const router = express.Router();
const callback = require('../controllers/callbackController');

router.post('/razorpay', callback.razorpay);

module.exports = router;
