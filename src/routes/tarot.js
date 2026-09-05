const express = require('express');
const router = express.Router();
const tarot = require('../controllers/tarotController');

router.get('/daily', tarot.getDailyTarot);
router.get('/yes-no', tarot.getYesNoTarot);
router.get('/past-present-future', tarot.getPastPresentFuture);
router.get('/love-triangle', tarot.getLoveTriangle);
router.get('/heartbreak', tarot.getHeartbreak);
router.get('/made-for-each-other', tarot.getMadeForEachOther);

module.exports = router;
