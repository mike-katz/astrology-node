const express = require('express');
const router = express.Router();
const pandits = require('../controllers/panditController');

const multer = require('multer');
const inMemoryStorage = multer.memoryStorage();
const singleImageUpload = multer({ storage: inMemoryStorage });

router.get('/', pandits.getPandits);
router.get('/detail', pandits.getPanditDetail);
router.post('/signup', pandits.signup);
router.post('/verifyOtp', pandits.verifyOtp);
router.post('/reSendOtp', pandits.reSendOtp);
router.post('/onboard', singleImageUpload.single('profile_image'), pandits.onboard);

module.exports = router;