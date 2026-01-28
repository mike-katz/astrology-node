const admin = require('firebase-admin');
const serviceAccount = require('./astro-1e9f7-firebase-adminsdk-fbsvc-4f429f67a7.json');
// Initialize Firebase Admin only if not already initialized
if (admin.apps.length === 0) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
    });
}

module.exports = admin;
