require('dotenv').config();
const express = require('express');
const app = express();
const authRoutes = require('./routes/auth');


app.use(express.json());


app.use('/api/auth', authRoutes);


app.get('/', (req, res) => res.send('Auth API is running'));


const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Server started on port ${port}`));