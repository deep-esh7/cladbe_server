const db = require("../../src/admin").firestore();

class LeadHelper {
  constructor() {
    if (!LeadHelper.instance) {
      LeadHelper.instance = this;
    }
    return LeadHelper.instance;
  }

  // Helper method to get number variants
  getNumberVariants(number) {
    const digits = number.replace(/\D/g, "");
    const lastTen = digits.slice(-10);
    return [
      lastTen, // Plain 10 digits
      `0${lastTen}`, // With 0 prefix
      `+91${lastTen}`, // With +91 prefix
      `91${lastTen}`, // With 91 prefix
    ];
  }

  async checkLeadExist(companyID, callerNumber) {
    try {
      if (!companyID || !callerNumber) {
        console.error(
          `Invalid inputs: companyID=${companyID}, callerNumber=${callerNumber}`
        );
        return null;
      }

      const numberVariants = this.getNumberVariants(callerNumber);
      console.log("Checking number variants:", numberVariants);

      const mobileNoQuery = db
        .collection("Companies")
        .doc(companyID)
        .collection("leads")
        .where("personalDetails.mobileNo", "in", numberVariants);

      const phoneQuery = db
        .collection("Companies")
        .doc(companyID)
        .collection("leads")
        .where("personalDetails.phone", "in", numberVariants);

      const [mobileNoSnapshot, phoneSnapshot] = await Promise.all([
        mobileNoQuery.get(),
        phoneQuery.get(),
      ]);

      console.log(
        `Query execution complete:
               Mobile matches: ${!mobileNoSnapshot.empty}
               Phone matches: ${!phoneSnapshot.empty}`
      );

      const allDocs = [...mobileNoSnapshot.docs, ...phoneSnapshot.docs];
      const uniqueDocs = Array.from(new Set(allDocs.map((doc) => doc.id))).map(
        (id) => allDocs.find((doc) => doc.id === id)
      );

      if (uniqueDocs.length > 0) {
        if (uniqueDocs.length > 1) {
          console.warn(`Multiple leads found for number ${callerNumber}:`, {
            count: uniqueDocs.length,
            leadIds: uniqueDocs.map((doc) => doc.id),
          });
        }

        const firstDoc = uniqueDocs[0];
        const doc = firstDoc.data();

        console.log(
          `Lead found. ID: ${firstDoc.id}, Name: ${doc.personalDetails?.name}`
        );

        const result = {
          baseid: firstDoc.id,
          ownerId: doc.owner?.id ?? null,
          name: doc.personalDetails?.name ?? null,
          mobileNo: doc.personalDetails?.mobileNo ?? null,
          phone: doc.personalDetails?.phone ?? null,
          email: doc.personalDetails?.email ?? null,
          ownerName: doc.owner?.name ?? null,
          designation: doc.owner?.designation ?? null,
          leadState: doc.leadState ?? null,
          coOwners: doc.coOwners ?? [],
          leadStatusType: doc.leadStatusType ?? null,
          projectData: Array.isArray(doc.projects) ? doc.projects : [],
          leadStatus: doc.status ?? null,
          leadSubStatus: doc.subStatus ?? null,
          otherDetails: doc.otherDetails ?? null,
        };

        console.log("Returning lead data:", JSON.stringify(result, null, 2));
        return result;
      } else {
        console.log(`No lead found for number ${callerNumber}`);
        return "Lead Not Exist";
      }
    } catch (error) {
      console.error("Error checking lead existence:", {
        error: error.message,
        stack: error.stack,
        companyID,
        callerNumber,
        timestamp: new Date().toISOString(),
      });
      return null;
    }
  }

  async updateLeadData(
    companyID,
    agentID,
    agentName,
    agentDesignation,
    leadID,
    stickyAgent,
    deleteCoOwners,
    otherDetails,
    projects
  ) {
    try {
      console.log("Updating lead data:", {
        companyID,
        agentID,
        agentDesignation,
        leadID,
      });

      if (stickyAgent == false) {
        const status = agentID === "" ? "Unallocated" : "Fresh";

        if (otherDetails) {
          await db
            .collection("Companies")
            .doc(companyID)
            .collection("leads")
            .doc(leadID)
            .update({
              "owner.designation": agentDesignation,
              "owner.id": agentID,
              "owner.name": agentName,
              status: otherDetails.status,
              subStatus: otherDetails.subStatus,
              source: otherDetails.source,
              subsource: otherDetails.subsource,
              projects: projects,
            });
        } else {
          await db
            .collection("Companies")
            .doc(companyID)
            .collection("leads")
            .doc(leadID)
            .update({
              "owner.designation": agentDesignation,
              "owner.id": agentID,
              "owner.name": agentName,
              status: status,
            });
        }
      } else {
        const coOwner = {
          id: agentID,
          designation: agentDesignation,
          name: agentName,
        };

        await this.addOwnerAndCoOwner(
          coOwner,
          companyID,
          leadID,
          deleteCoOwners
        );
      }

      console.log("Lead data updated successfully");
    } catch (error) {
      console.error("Error updating lead data:", error);
      throw error;
    }
  }

  async updateLeadState(companyId, leadId) {
    try {
      console.log("Updating lead state for:", { companyId, leadId });

      await db
        .collection("Companies")
        .doc(companyId)
        .collection("leads")
        .doc(leadId)
        .update({
          leadState: "active",
        });

      console.log("Lead state updated successfully");
    } catch (error) {
      console.error("Error updating lead state:", error);
      throw error;
    }
  }

  async getCoOwnerList(companyId, leadId) {
    try {
      const doc = await db
        .collection("Companies")
        .doc(companyId)
        .collection("leads")
        .doc(leadId)
        .get();

      return doc.exists ? doc.data().coOwners || [] : [];
    } catch (error) {
      console.error("Error getting co-owner list:", error);
      return [];
    }
  }

  async addOwnerAndCoOwner(coOwnerDetails, companyId, leadId, deleteCoOwners) {
    try {
      const leadRef = db
        .collection("Companies")
        .doc(companyId)
        .collection("leads")
        .doc(leadId);

      if (deleteCoOwners === undefined || deleteCoOwners === false) {
        const coOwnerList = await this.getCoOwnerList(companyId, leadId);

        if (!coOwnerList.some((coOwner) => coOwner.id === coOwnerDetails.id)) {
          coOwnerList.push(coOwnerDetails);

          await leadRef.update({
            coOwners: coOwnerList,
          });
        }
      } else {
        await leadRef.update({
          coOwners: [],
        });
      }

      console.log("Co-owner operation completed successfully");
    } catch (error) {
      console.error("Error in co-owner operation:", error);
      throw error;
    }
  }
}

// Create and export singleton instance
const leadHelper = new LeadHelper();
module.exports = leadHelper;
