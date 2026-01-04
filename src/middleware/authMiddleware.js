const jwt = require('jsonwebtoken');
require('dotenv').config();
const { decrypt } = require("../utils/crypto")


module.exports = function (req, res, next) {
    const authHeader = req.headers.authorization;
    // console.log("authHeader", authHeader);
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res
            .status(401)
            .json({ message: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decryptToken = decrypt(token);
        // console.log("decryptToken", decryptToken);
        const verified = jwt.verify(decryptToken, process.env.JWT_SECRET);
        // console.log("verified", verified);
        if (!verified) {
            return res
                .status(401)
                .json({ message: 'Unauthorized: Missing or invalid token' });
        }
        req.user = verified?.username
        req.userId = verified?.userId
        next();
    } catch (error) {
        console.error('Error in authenticateJWT:', error);
        return res
            .status(401)
            .json({ message: 'Unauthorized: Missing or invalid token' });
    }
};