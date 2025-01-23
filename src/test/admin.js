const admin = require("firebase-admin");
const path = require("path");

// Add debug logging
const envPath = path.resolve(__dirname, "../environment/.env");
console.log("Loading env from:", envPath);

require("dotenv").config({
  path: envPath,
  debug: true, // Enable dotenv debug
});

// Log env var for debugging
console.log("FIREBASE_CONFIG present:", !!process.env.FIREBASE_CONFIG);

try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "gs://cladbee-6554e.appspot.com",
    databaseURL:
      "https://cladbee-6554e-default-rtdb.asia-southeast1.firebasedatabase.app",
  });

  console.log("Firebase initialized successfully");
} catch (error) {
  console.error("Firebase Initialization Error:", error.message);
  process.exit(1);
}

module.exports = admin;
