const express = require('express');
const router = express.Router();
const pandits = require('../controllers/panditController');

router.get('/', pandits.getPandits);
router.post('/signup', pandits.signup);
router.post('/verifyOtp', pandits.verifyOtp);
router.post('/reSendOtp', pandits.reSendOtp);
router.post('/onboard', pandits.onboard);
module.exports = router;