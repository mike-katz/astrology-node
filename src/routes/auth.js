const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { register, login, verifyOtp } = require('../controllers/authController');


// POST /api/auth/register
router.post('/register', [
    body('username').isLength({ min: 3 }).withMessage('username min 3 chars'),
    body('email').isEmail().withMessage('invalid email'),
    body('password').isLength({ min: 6 }).withMessage('password min 6 chars')
], register);


// POST /api/auth/login
router.post('/login', login);

router.post('/verifyOtP', verifyOtp);

module.exports = router;