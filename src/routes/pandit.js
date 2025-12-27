const express = require('express');
const router = express.Router();
const pandits = require('../controllers/panditController');

const multer = require('multer');


const storage = multer.memoryStorage(); // or diskStorage

const upload = multer({
    storage,
    limits: {
        files: 20,              // total files limit
        fileSize: 5 * 1024 * 1024 // 5MB per file
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/jpg',
            'application/pdf'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only images & PDFs allowed'), false);
        }
    }
});
router.get('/', pandits.getPandits);
router.get('/detail', pandits.getPanditDetail);
router.post('/signup', pandits.signup);
router.post('/verifyOtp', pandits.verifyOtp);
router.post('/reSendOtp', pandits.reSendOtp);
router.post('/onboard',
    upload.fields([
        { name: 'certificate', maxCount: 5 },
        { name: 'address', maxCount: 5 },
        { name: 'selfie', maxCount: 1 },
        { name: 'profile', maxCount: 1 },
        { name: 'achievement', maxCount: 1 },
    ]),
    pandits.onboard);
router.get('/reviewList', pandits.getReviewList);

router.post('/file',
    upload.fields([
        { name: 'file', maxCount: 1 },
    ]),
    pandits.uploadImage);

module.exports = router;