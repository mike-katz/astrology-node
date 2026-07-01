const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { register, login, verifyOtp, socialUrl, getSettings, sendCall, test, googleLogin, appleLogin } = require('../controllers/authController');

router.get('/setting', getSettings);

// POST /api/auth/register
router.post('/register', [
    body('username').isLength({ min: 3 }).withMessage('username min 3 chars'),
    body('email').isEmail().withMessage('invalid email'),
    body('password').isLength({ min: 6 }).withMessage('password min 6 chars')
], register);


// POST /api/auth/login
router.post('/login', login);

router.post('/verifyOtP', verifyOtp);
// POST /auth/google — body: { id_token } or { idToken } from Google Sign-In; optional: type, version, ad_set_id, utm_source, ad_id, referrer
router.get('/google', googleLogin);
// POST /auth/apple — same payload pattern as Google; Apple identity JWT in token | identity_token | identityToken
router.get('/apple', appleLogin);
router.get('/config', socialUrl);
router.post('/test-call', sendCall);
router.get('/test', test);

module.exports = router;