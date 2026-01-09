const express = require('express');
const router = express.Router();
const kundli = require('../controllers/kundliController');

router.get('/basic', kundli.findBasicKundli);
router.get('/kundli', kundli.findkundliTab);
router.get('/kp', kundli.findkpTab);
router.get('/ashtakvarga', kundli.findAshtakvargaTab);
router.get('/chart', kundli.findChartTab);
router.get('/dasha', kundli.findDashaTab);
router.get('/report', kundli.findReportTab);

module.exports = router;