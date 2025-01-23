const admin = require("firebase-admin");
const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "../../environment/.env"),
});

try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

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
