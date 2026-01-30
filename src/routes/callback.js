const express = require('express');
const router = express.Router();
const callback = require('../controllers/callbackController');

router.get('/razorpay', callback.razorpay);

module.exports = router;
