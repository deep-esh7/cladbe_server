const admin = require("firebase-admin");
const path = require("path");

// Add debug logging
const envPath = path.resolve(__dirname, "./.env");
console.log("Loading env from:", envPath);

require("dotenv").config({
  path: envPath,
  debug: true,
});

// Log env var for debugging
console.log(
  "FIREBASE_CONFIG_BASE64 present:",
  !!process.env.FIREBASE_CONFIG_BASE64
);

try {
  // Decode and parse Firebase config
  const decodedConfig = Buffer.from(
    process.env.FIREBASE_CONFIG_BASE64,
    "base64"
  ).toString();
  const serviceAccount = JSON.parse(decodedConfig);

  // Ensure private key is properly formatted
  if (
    serviceAccount.private_key &&
    !serviceAccount.private_key.includes("\n")
  ) {
    serviceAccount.private_key = serviceAccount.private_key.replace(
      /\\n/g,
      "\n"
    );
  }

  // Initialize Firebase with SSL settings
  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "gs://cladbee-6554e.appspot.com",
    databaseURL:
      "https://cladbee-6554e-default-rtdb.asia-southeast1.firebasedatabase.app",
  });

  // Configure Firestore settings
  admin.firestore().settings({
    ignoreUndefinedProperties: true,
    ssl: true,
  });

  // Test connection (optional but helpful for debugging)
  admin
    .firestore()
    .collection("test")
    .doc("test")
    .get()
    .then(() => console.log("🟢 Firestore connection verified"))
    .catch((err) => console.warn("⚠️ Firestore connection test:", err.message));

  console.log("✅ Firebase initialized successfully");
} catch (error) {
  console.error("❌ Firebase Initialization Error:", {
    message: error.message,
    stack: error.stack,
    details: error.details || "No additional details",
  });
  process.exit(1);
}

// Add error handlers for ongoing operation
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

module.exports = admin;
