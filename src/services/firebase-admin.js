const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

if (!admin.apps.length) {
    const serviceAccountPathEnv =
        process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS;

    const serviceAccountPath = serviceAccountPathEnv
        ? path.resolve(serviceAccountPathEnv)
        : path.resolve('tulkka-firebase-adminsdk-douvv-4b2c75eda1.json');

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
    });
}

const databaseId = process.env.FIRESTORE_DATABASE_ID;
const db = databaseId ? getFirestore(admin.app(), databaseId) : getFirestore(admin.app());
const messaging = admin.messaging();

module.exports = { admin, db, messaging };
