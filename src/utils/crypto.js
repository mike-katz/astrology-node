const CryptoJS = require('crypto-js');
require('dotenv').config();

const secretKey = process.env.ENCRYPTION_KEY;

const encrypt = (text) => {
    try {
        return CryptoJS.AES.encrypt(text, secretKey).toString();
    } catch (error) {
        console.error('Error in encrypt function:', error);
        throw error;
    }
};

const decrypt = (cipherText) => {
    try {
        const bytes = CryptoJS.AES.decrypt(cipherText, secretKey);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (error) {
        console.error('Error in decrypt function:', error);
        throw error;
    }
};

module.exports = { encrypt, decrypt };
