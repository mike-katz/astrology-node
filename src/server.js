require('dotenv').config();
const express = require('express');
const app = express();
const auth = require('./middleware/authMiddleware.js');

const authRoutes = require('./routes/auth');
const panditRoutes = require('./routes/pandit');
const followRoutes = require('./routes/follow');
const reviewRoutes = require('./routes/review');
const userRoutes = require('./routes/user');
const orderRoutes = require('./routes/order');
const profileRoutes = require('./routes/profile');
const paymentRoutes = require('./routes/payment');
const multer = require('multer');

const chatRoutes = require('./routes/chat');
const { decryptRequest } = require('./middleware/decryptRequest.js');
const { encryptResponse } = require('./middleware/encryptResponse.js')

app.use(express.json());

app.use(decryptRequest);
app.use(encryptResponse);

app.use('/auth', authRoutes);
app.use('/pandit', panditRoutes);

app.use(auth)
app.use('/chat', chatRoutes);
app.use('/order', orderRoutes);
app.use('/user', userRoutes);
app.use('/follow', followRoutes);
app.use('/review', reviewRoutes);
app.use('/profile', profileRoutes);
app.use('/payment', paymentRoutes);

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ success: false, message: err.message });
    }
    if (err) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next();
});
const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server started on port ${port}`));