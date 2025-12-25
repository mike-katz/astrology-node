const express = require('express');
const router = express.Router();
const user = require('../controllers/userController');

router.get('/', user.getProfile);
router.get('/balance', user.getBalance);
router.post('/update', user.updateProfile);
module.exports = router;