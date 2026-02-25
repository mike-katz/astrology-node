const express = require('express');
const router = express.Router();
const kundli = require('../controllers/kundliController');

router.get('/basic', kundli.getFreeBasicKundli);
router.get('/kp', kundli.getFreekpTab);
router.get('/ashtakvarga', kundli.getFreeAshtakvargaTab);
router.get('/dasha', kundli.getFreeDashaTab);
router.get('/general-report', kundli.getGeneralReport);
router.get('/remedie-report', kundli.getRemedieReport);
router.get('/dosha-report', kundli.getDoshaReport);
router.get('/north-lagna-chart', kundli.getFreeLagnaChart);
router.get('/north-navamsa-chart', kundli.getFreeNavamsaChart);
router.get('/north-transit-chart', kundli.getFreeTransitChart);
router.get('/north-divisional-chart', kundli.getFreeDivisionalChart);

router.get('/south-lagna-chart', kundli.getFreeSouthLagnaChart);
router.get('/south-navamsa-chart', kundli.getFreeSouthNavamsaChart);
router.get('/south-transit-chart', kundli.getFreeSouthTransitChart);
router.get('/south-divisional-chart', kundli.getFreeSouthDivisionalChart);

module.exports = router;

