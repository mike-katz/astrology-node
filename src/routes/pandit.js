const express = require('express');
const router = express.Router();
const { getPandits, onboard, signup, verifyOtp } = require('../controllers/panditController');

router.get('/', getPandits);
router.post('/signup', signup);
router.post('/verifyOtp', verifyOtp);
router.post('/onboard', onboard);
module.exports = router;