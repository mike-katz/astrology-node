const { decrypt } = require('../utils/crypto.js');
require('dotenv').config();

const decryptRequest = (req, res, next) => {
  if (process.env.isTest === 'true') {
    if (Object.keys(req.body).length > 1) {
      return res.status(400).json({
        message: 'Unauthorized request. Only payload key is allowed.',
      });
    }

    if (req.body.payload) {
      req.body = req.body.payload;
    } else if (req.query) {
      req.body = req.query;
    }

    return next();
  }

  try {
    if (Object.keys(req.body).length > 1 || Object.keys(req.query).length > 1) {
      return res.status(400).json({
        message: 'Unauthorized request. Only payload key is allowed.',
      });
    }

    if (req.body.payload) {
      req.body = JSON.parse(decrypt(req.body.payload));
    } else if (req.query.payload) {
      req.query = JSON.parse(decrypt(req.query.payload));
    }
    if (!req.body) {
      return res.status(400).json({ message: 'Unable to decrypt payload.' });
    }

    next();
  } catch (error) {
    console.error('Error in decrypting request:', error);
    res.status(400).json({ message: 'Unable to decrypt payload.' });
  }
};

module.exports = { decryptRequest };
