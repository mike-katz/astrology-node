
const { decrypt } = require('./crypto');
require('dotenv').config();
const jwt = require('jsonwebtoken');

const decodeJWT = (authHeader) => {
    try {
        const token = authHeader.split(' ')[1];
        const decryptToken = decrypt(token);
        console.log("decryptToken", decryptToken);
        console.log("process.env.JWT_SECRET", process.env.JWT_SECRET);
        const verified = jwt.verify(decryptToken, process.env.JWT_SECRET);
        return { success: true, data: verified }
    } catch (error) {
        return { success: false, message: "Something went wrong" }
    }
};

module.exports = { decodeJWT };

