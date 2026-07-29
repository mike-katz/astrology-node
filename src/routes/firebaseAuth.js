const express = require('express');
const router = express.Router();
const { sendFirebaseOtp, verifyFirebaseOtp, getFirebaseRecaptchaParams } = require('../controllers/authController');

// Firebase Phone Auth only (separate from /auth SMS login)
router.get('/recaptcha-params', getFirebaseRecaptchaParams);
router.post('/login', sendFirebaseOtp);
router.post('/verify-otp', verifyFirebaseOtp);

module.exports = router;
