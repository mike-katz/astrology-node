const express = require('express');
const router = express.Router();
const order = require('../controllers/orderController');


router.post('/create', order.create);
router.post('/acceptOrder', order.acceptOrder);
router.post('/cancelOrder', order.cancelOrder);
router.get('/list', order.list);
router.delete('/delete', order.deleteOrder);

router.post('/sendGift', order.sendGift);
router.post('/makeCall', order.generateCallToken);

module.exports = router;