const express = require('express');
const router = express.Router();
const astroRemedy = require('../controllers/astroRemedyController');

router.get('/', astroRemedy.getRemedyList);
router.get('/product', astroRemedy.getRemedyItems);
router.get('/detail', astroRemedy.getRemedyDetail);
router.post('/order/create', astroRemedy.getRemedyOrderCreate);

module.exports = router;
