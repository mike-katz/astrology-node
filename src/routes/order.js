const express = require('express');
const router = express.Router();
const order = require('../controllers/orderController');

router.post('/create', order.create);
router.get('/list', order.list);
router.post('/acceptOrder', order.acceptOrder);
module.exports = router;