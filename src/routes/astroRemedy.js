const express = require('express');
const router = express.Router();
const astroRemedy = require('../controllers/astroRemedyController');
const remedyOrder = require('../controllers/remedyOrderController');

router.get('/', astroRemedy.getRemedyList);
router.get('/product', astroRemedy.getRemedyItems);
router.get('/detail', astroRemedy.getRemedyDetail);
router.post('/order/create', astroRemedy.getRemedyOrderCreate);
router.get('/order/list', remedyOrder.getUserOrders);

module.exports = router;
