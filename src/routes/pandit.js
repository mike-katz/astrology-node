const express = require('express');
const router = express.Router();
const { getPandits, signup } = require('../controllers/panditController');

router.get('/', getPandits);
router.post('/signup', signup);

module.exports = router;