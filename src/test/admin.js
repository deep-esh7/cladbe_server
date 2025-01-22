const admin = require("firebase-admin");

let serviceAccount;
try {
  console.log("Initializing Firebase Admin...");

  if (!process.env.FIREBASE_CONFIG) {
    throw new Error("FIREBASE_CONFIG environment variable is not set");
  }

  // Parse the Firebase config from environment variable
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
  } catch (parseError) {
    console.error("Failed to parse FIREBASE_CONFIG:", parseError);
    throw new Error("Invalid FIREBASE_CONFIG format");
  }

  // Log config structure for debugging (not actual values)
  console.log("Firebase Config Structure:", {
    hasProjectId: !!serviceAccount.project_id,
    hasPrivateKey: !!serviceAccount.private_key,
    hasClientEmail: !!serviceAccount.client_email,
  });

  // Initialize Firebase Admin SDK
  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "gs://cladbee-6554e.appspot.com",
    databaseURL:
      "https://cladbee-6554e-default-rtdb.asia-southeast1.firebasedatabase.app",
  });

  console.log(
    `Firebase Admin SDK initialized for project: ${serviceAccount.project_id}`
  );
} catch (error) {
  console.error("Firebase Initialization Error:", error.message);
  process.exit(1);
}

module.exports = admin;
