const express = require('express');
const router = express.Router();
const astroRemedy = require('../controllers/astroRemedyController');
const remedyOrder = require('../controllers/remedyOrderController');

router.get('/', astroRemedy.getRemedyList);
router.get('/product', astroRemedy.getRemedyItems);
router.get('/detail', astroRemedy.getRemedyDetail);
router.get('/faq', astroRemedy.getRemedyFaq);
router.get('/howitworks', astroRemedy.getRemedyHowItWorks);
router.post('/order/create', astroRemedy.getRemedyOrderCreate);
router.post('/order/cancel', remedyOrder.cancelOrder);
router.post('/order/instruction', remedyOrder.addUserInstruction);
router.get('/order/list', remedyOrder.getUserOrders);
router.get('/order/detail', remedyOrder.getOrderDetail);
router.post('/order/feedback', remedyOrder.addFeedback);
router.post('/order/complete', remedyOrder.completeOrder);

module.exports = router;
