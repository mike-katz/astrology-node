const express = require('express');
const router = express.Router();
const offer = require('../controllers/offerController');

router.get('/', offer.getOfferList);
router.post('/apply', offer.applyOffer);

module.exports = router;
