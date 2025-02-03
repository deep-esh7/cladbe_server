const db = require("../../src/admin").firestore();

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

      const querySnapshot = await db
        .collection("masterCollection")
        .doc("didNumbers")
        .collection("didNumbers")
        .where("didNumber", "==", callToNumber)
        .get();

      if (querySnapshot.empty) {
        console.log(`No DID found for number: ${callToNumber}`);
        throw new Error("No allocated company found for this number.");
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
        throw new Error("No active company allocation found for this number.");
      }

      console.log(
        `Found company details for number ${callToNumber}:`,
        companyDetails
      );
      return companyDetails;
    } catch (error) {
      console.error("Error getting company ID and provider:", error);
      throw error;
    }
  }
}

// Create and export a singleton instance
const companyHelper = new CompanyHelper();
module.exports = companyHelper;
