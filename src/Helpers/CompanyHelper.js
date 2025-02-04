// CompanyHelper.js
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

      console.log("Fetching company details for DID:", callToNumber);

      // Adding retry mechanism
      let retryCount = 0;
      const maxRetries = 3;
      let lastError = null;

      while (retryCount < maxRetries) {
        try {
          const db = admin.firestore();
          const querySnapshot = await db
            .collection("masterCollection")
            .doc("didNumbers")
            .collection("didNumbers")
            .where("didNumber", "==", callToNumber)
            .get();

          if (querySnapshot.empty) {
            console.log(`No DID found for number: ${callToNumber}`);
            // Return default values instead of throwing error
            return {
              companyId: process.env.DEFAULT_COMPANY_ID || "DEFAULT",
              provider: process.env.DEFAULT_PROVIDER || "tata",
            };
          }

          let companyDetails = null;
          querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.didStatus === "active") {
              companyDetails = {
                companyId: data.assignedToCompanyId,
                provider: data.provider,
              };
            }
          });

          if (!companyDetails) {
            console.log(`No active DID found for number: ${callToNumber}`);
            // Return default values instead of throwing error
            return {
              companyId: process.env.DEFAULT_COMPANY_ID || "DEFAULT",
              provider: process.env.DEFAULT_PROVIDER || "tata",
            };
          }

          console.log(
            `Found company details for number ${callToNumber}:`,
            companyDetails
          );
          return companyDetails;
        } catch (error) {
          lastError = error;
          console.error(`Attempt ${retryCount + 1} failed:`, error);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * retryCount)
            );
          }
        }
      }

      console.error("All retry attempts failed for Firestore query");
      // Return default values after all retries fail
      return {
        companyId: process.env.DEFAULT_COMPANY_ID || "DEFAULT",
        provider: process.env.DEFAULT_PROVIDER || "tata",
      };
    } catch (error) {
      console.error("Error getting company ID and provider:", error);
      // Return default values instead of throwing error
      return {
        companyId: process.env.DEFAULT_COMPANY_ID || "DEFAULT",
        provider: process.env.DEFAULT_PROVIDER || "tata",
      };
    }
  }
}

// Create and export a singleton instance
const companyHelper = new CompanyHelper();
module.exports = companyHelper;
