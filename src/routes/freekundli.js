const express = require('express');
const router = express.Router();
const kundli = require('../controllers/kundliController');

router.get('/basic', kundli.getFreeBasicKundli);
router.get('/kp', kundli.getFreekpTab);
module.exports = router;

