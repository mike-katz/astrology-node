const express = require('express');
const router = express.Router();
const order = require('../controllers/orderController');

router.post('/create', order.create);
module.exports = router;