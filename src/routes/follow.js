const express = require('express');
const router = express.Router();
const { addFollow } = require('../controllers/followController');

router.post('/', addFollow);
router.get('/', getFollow);
module.exports = router;