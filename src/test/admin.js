const admin = require("firebase-admin");

let serviceAccount;
try {
  console.log("Environment check:", {
    hasConfig: !!process.env.FIREBASE_CONFIG,
    configType: typeof process.env.FIREBASE_CONFIG,
    envKeys: Object.keys(process.env)
  });

  if (!process.env.FIREBASE_CONFIG) {
    throw new Error('FIREBASE_CONFIG environment variable is not set or is undefined');
  }

  // Try parsing the config if it's a string
  try {
    serviceAccount = typeof process.env.FIREBASE_CONFIG === 'string' 
      ? JSON.parse(process.env.FIREBASE_CONFIG)
      : process.env.FIREBASE_CONFIG;
  } catch (parseError) {
    console.error("Failed to parse FIREBASE_CONFIG:", parseError);
    throw new Error('Invalid FIREBASE_CONFIG format');
  }

  // Log the structure (but not the actual values) of serviceAccount
  console.log("Service Account Structure:", Object.keys(serviceAccount));

  // Validate the required fields
  const requiredFields = ['project_id', 'private_key', 'client_email'];
  const missingFields = requiredFields.filter(field => !serviceAccount[field]);
  
  if (missingFields.length > 0) {
    throw new Error(`FIREBASE_CONFIG is missing required fields: ${missingFields.join(', ')}`);
  }

  // Ensure private_key is properly formatted
  if (serviceAccount.private_key.includes('\\n')) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
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
    databaseURL: "https://cladbee-6554e-default-rtdb.asia-southeast1.firebasedatabase.app",
  });

  console.log(`Firebase Admin SDK initialized successfully for project: ${serviceAccount.project_id}`);
} catch (error) {
  console.error("Firebase Initialization Error:", error);
  process.exit(1);
}

module.exports = admin;