const express = require('express');
const router = express.Router();
const payment = require('../controllers/paymentController');

router.post('/', payment.addPayment);
router.get('/', payment.getPayment);
router.get('/transactions', payment.getTransactions);

module.exports = router;