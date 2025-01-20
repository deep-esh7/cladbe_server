const admin = require("firebase-admin");

// Get Firebase config from environment variable
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
} catch (error) {
  console.error("Error parsing FIREBASE_CONFIG:", error);
  // Fallback to local file if environment variable is not available (for development)
  serviceAccount = require("./cladbe_servicekey.json");
}

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "gs://cladbee-6554e.appspot.com",
  databaseURL:
    "https://cladbee-6554e-default-rtdb.asia-southeast1.firebasedatabase.app",
});

// Log successful initialization but don't expose sensitive details
console.log("Firebase Admin SDK initialized successfully");

module.exports = admin;
