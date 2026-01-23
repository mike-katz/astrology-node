const jwt = require('jsonwebtoken');
require('dotenv').config();
const { decrypt } = require("../utils/crypto")
const { getCache } = require("../config/redisClient")


module.exports = async function (req, res, next) {
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

        // Get user from database to get username
        // Check if token exists in Redis
        const username = verified?.userId;
        const redisKey = `user_${username}`;
        const redisToken = await getCache(redisKey);

        if (!redisToken || redisToken !== token) {
            return res
                .status(401)
                .json({ success: false, message: 'Unauthorized: Token invalid' });
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