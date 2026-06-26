const express = require('express');
const router = express.Router();
const feedback = require('../controllers/feedbackController');

router.post('/', feedback.createFeedback);

module.exports = router;
