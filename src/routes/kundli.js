const express = require('express');
const router = express.Router();
const kundli = require('../controllers/kundliController');

router.get('/basic', kundli.findBasicKundli);

module.exports = router;