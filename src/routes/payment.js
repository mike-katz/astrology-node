const express = require('express');
const router = express.Router();
const payment = require('../controllers/paymentController');

router.post('/', payment.addPayment);
router.get('/', payment.getPayment);
router.get('/transactions', payment.getTransactions);

router.delete('/single', payment.deleteSinglePayment);
router.delete('/single/transaction', payment.deleteSingleTransaction);

router.delete('/all', payment.deleteAllPayment);
router.delete('/all-transaction', payment.deleteAllTransaction);

module.exports = router;