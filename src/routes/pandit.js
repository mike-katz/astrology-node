const express = require('express');
const router = express.Router();
const { getPandits } = require('../controllers/panditController');

router.get('/', getPandits);

module.exports = router;