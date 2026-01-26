const express = require('express');
const router = express.Router();
const { getList, getDetail, getCategory } = require('../controllers/blogController');

router.get('/', getList);
router.get('/detail', getDetail);
router.get('/category', getCategory);

module.exports = router;
