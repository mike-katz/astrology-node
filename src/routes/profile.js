const express = require('express');
const router = express.Router();
const profile = require('../controllers/profileController');

router.post('/', profile.addProfile);
router.post('/update', profile.updateProfile);
router.delete('/', profile.deleteProfile);
router.get('/', profile.getList);
module.exports = router;