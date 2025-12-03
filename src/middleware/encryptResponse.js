const { encrypt } = require('../utils/crypto.js');
require('dotenv').config();


const encryptResponse = (req, res, next) => {
  const originalSend = res.send;
  const isTest = process.env.isTest === "true" ? true : false;

  res.send = function (body) {
    try {
      body = isTest ? JSON.parse(body) : encrypt(body);
      const statusCode = res.statusCode;
      const responseBody = JSON.stringify({
        success: statusCode === 200,
        data: statusCode === 200 ? body : null,
        error: statusCode !== 200 ? body : null,
      });

      return originalSend.call(this, responseBody);
    } catch (error) {
      console.error("Error in encryptResponse:", error);
      return next(error);
    }
  };

  next();
};

module.exports = { encryptResponse };
