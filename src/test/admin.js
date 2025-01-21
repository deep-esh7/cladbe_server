const admin = require("firebase-admin");

let serviceAccount;
try {
  // Check if the config is already an object (Railway might automatically parse it)
  serviceAccount =
    typeof process.env.FIREBASE_CONFIG === "string"
      ? JSON.parse(process.env.FIREBASE_CONFIG)
      : process.env.FIREBASE_CONFIG;

  // Validate the required fields
  if (
    !serviceAccount.project_id ||
    !serviceAccount.private_key ||
    !serviceAccount.client_email
  ) {
    throw new Error("FIREBASE_CONFIG is missing required fields");
  }

  // Ensure private_key is properly formatted
  if (serviceAccount.private_key.includes("\\n")) {
    serviceAccount.private_key = serviceAccount.private_key.replace(
      /\\n/g,
      "\n"
    );
  }
} catch (error) {
  console.error("Firebase Config Error:", error.message);
  process.exit(1);
}

// Initialize Firebase Admin SDK
try {
  const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "gs://cladbee-6554e.appspot.com",
    databaseURL:
      "https://cladbee-6554e-default-rtdb.asia-southeast1.firebasedatabase.app",
  });

  console.log(
    `Firebase Admin SDK initialized successfully for project: ${serviceAccount.project_id}`
  );
} catch (error) {
  console.error("Firebase Initialization Error:", error);
  process.exit(1);
}

module.exports = admin;
