require('dotenv').config();
const express = require('express');
const app = express();
const auth = require('./middleware/authMiddleware.js');

const authRoutes = require('./routes/auth');
const panditRoutes = require('./routes/pandit');
const followRoutes = require('./routes/follow');
const reviewRoutes = require('./routes/review');

const { decryptRequest } = require('./middleware/decryptRequest.js');
const { encryptResponse } = require('./middleware/encryptResponse.js')

app.use(express.json());

app.use(decryptRequest);
app.use(encryptResponse);

app.use('/auth', authRoutes);
app.use('/pandit', panditRoutes);
app.use(auth)

app.use('/follow', followRoutes);
app.use('/review', reviewRoutes);

app.get('/', (req, res) => res.send('Auth API is running'));

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server started on port ${port}`));