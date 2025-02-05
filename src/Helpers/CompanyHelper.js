const admin = require("../../src/admin");

class CompanyHelper {
  constructor() {
    if (!CompanyHelper.instance) {
      CompanyHelper.instance = this;
    }
    return CompanyHelper.instance;
  }

  async getCompanyIdAndProvider(callToNumber) {
    try {
      if (!callToNumber) {
        throw new Error("Call number is required");
      }

      // Clean up the number - remove any '+' prefix and whitespace
      const cleanNumber = callToNumber.toString().replace("+", "").trim();

      console.log("Fetching company details for DID:", cleanNumber);

      const db = admin.firestore();
      const querySnapshot = await db
        .collection("masterCollection")
        .doc("didNumbers")
        .collection("didNumbers")
        .where("didNumber", "==", cleanNumber)
        .get();

      if (querySnapshot.empty) {
        throw new Error("No allocated company found for this number");
      }

      let found = false;
      let result = null;

      querySnapshot.forEach((doc) => {
        if (doc.data().didStatus === "active") {
          found = true;
          result = {
            companyId: doc.data().assignedToCompanyId,
            provider: doc.data().provider,
          };
        }
      });

      if (!found) {
        throw new Error("No active DID found for this number");
      }

      return result;
    } catch (error) {
      console.error("Error getting company ID and provider:", {
        error: error.message,
        callToNumber,
      });
      throw error;
    }
  }
}

// Create and export singleton instance
const companyHelper = new CompanyHelper();
module.exports = companyHelper;
