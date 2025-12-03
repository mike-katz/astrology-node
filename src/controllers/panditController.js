const db = require('../db');
require('dotenv').config();

async function getPandits(req, res) {
    const user = await db('pandits').first();
    console.log("user", user);
    return res.status(200).json({ data: user, message: 'Login success' });
}


module.exports = { getPandits };
