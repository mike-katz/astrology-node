const express = require('express');
const router = express.Router();
const { getList } = require('../controllers/blogController');

router.get('/', getList);

module.exports = router;
