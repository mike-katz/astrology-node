const express = require('express');
const router = express.Router();
const { addReview, addReplay } = require('../controllers/reviewController');

router.post('/', addReview);
router.post('/replay', addReplay);
module.exports = router;