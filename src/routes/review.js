const express = require('express');
const router = express.Router();
const { addReview, addReplay, getList } = require('../controllers/reviewController');

router.post('/', addReview);
router.post('/replay', addReplay);
router.get('/', getList);
module.exports = router;