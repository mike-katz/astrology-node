const express = require('express');
const router = express.Router();
const { addReview, addReplay, getList, getReviewDetail } = require('../controllers/reviewController');

router.post('/', addReview);
router.post('/replay', addReplay);
router.get('/', getList);
router.get('/detail', getReviewDetail);
module.exports = router;