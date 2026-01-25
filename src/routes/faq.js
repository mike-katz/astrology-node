const express = require('express');
const router = express.Router();
const { getList } = require('../controllers/faqController');

router.get('/', getList);

module.exports = router;
