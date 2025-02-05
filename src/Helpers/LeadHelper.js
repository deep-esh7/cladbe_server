const db = require("../../src/admin").firestore();
const moment = require("moment-timezone");
const { v4: uuidv4 } = require("uuid");
const {
  Lead,
  LeadPersonalDetails,
  LeadOwner,
} = require("../tataCalling/models/lead_model");
// const ChatroomService = require("../Services/ChatroomService");
// const {
//   createChatRoomModel,
//   createChatMessage,
// } = require("../helpers/chathelper");

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

      const [mobileNoSnapshot, phoneSnapshot] = await Promise.all([
        db
          .collection("Companies")
          .doc(companyID)
          .collection("leads")
          .where("personalDetails.mobileNo", "in", numberVariants)
          .get(),
        db
          .collection("Companies")
          .doc(companyID)
          .collection("leads")
          .where("personalDetails.phone", "in", numberVariants)
          .get(),
      ]);

      const allDocs = [...mobileNoSnapshot.docs, ...phoneSnapshot.docs];
      const uniqueDocs = Array.from(new Set(allDocs.map((doc) => doc.id))).map(
        (id) => allDocs.find((doc) => doc.id === id)
      );

      if (uniqueDocs.length > 0) {
        const firstDoc = uniqueDocs[0];
        const doc = firstDoc.data();

        return {
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
      }

      return "Lead Not Exist";
    } catch (error) {
      console.error("Error checking lead existence:", error);
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

        const updateData = otherDetails
          ? {
              "owner.designation": agentDesignation,
              "owner.id": agentID,
              "owner.name": agentName,
              status: otherDetails.status,
              subStatus: otherDetails.subStatus,
              source: otherDetails.source,
              subsource: otherDetails.subsource,
              projects: projects,
            }
          : {
              "owner.designation": agentDesignation,
              "owner.id": agentID,
              "owner.name": agentName,
              status: status,
            };

        await db
          .collection("Companies")
          .doc(companyID)
          .collection("leads")
          .doc(leadID)
          .update(updateData);
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
    } catch (error) {
      console.error("Error updating lead data:", error);
      throw error;
    }
  }

  async createLead(clientNumber, companyId, conditionDetails = {}) {
    const leadgen_id = uuidv4();
    const companyName = "COMPANY_NAME";

    try {
      // Check for existing lead
      let mobileQuerySnapshot = await db
        .collection(`Companies/${companyId}/leads`)
        .where("personalDetails.mobileNo", "==", clientNumber)
        .limit(1)
        .get();

      let phoneQuerySnapshot = await db
        .collection(`Companies/${companyId}/leads`)
        .where("personalDetails.phone", "==", clientNumber)
        .limit(1)
        .get();

      if (!mobileQuerySnapshot.empty || !phoneQuerySnapshot.empty) {
        const existingLeadId = mobileQuerySnapshot.empty
          ? phoneQuerySnapshot.docs[0].id
          : mobileQuerySnapshot.docs[0].id;

        console.log("Lead re-enquired, lead ID:", existingLeadId);

        const message = createChatMessage(
          companyName,
          companyId,
          "lead re-inquired"
        );
        const chatroomSnapshot = await db
          .collection(`Companies/${companyId}/leads/${existingLeadId}/Chatroom`)
          .limit(1)
          .get();

        if (!chatroomSnapshot.empty) {
          const firstDoc = chatroomSnapshot.docs[0];
          await db
            .collection(
              `Companies/${companyId}/leads/${existingLeadId}/Chatroom/${firstDoc.id}/Messages`
            )
            .doc(message.messageId)
            .set(message.toObject());
        }

        return { leadId: existingLeadId };
      }

      const clientName = await this.getLeadTempLeadName(companyId);

      const leadPersonalDetails = new LeadPersonalDetails({
        name: clientName,
        mobileNo: clientNumber,
        email: "",
      });

      const leadOwner = new LeadOwner({
        name: "",
        designation: "",
        id: "",
      });

      const newLead = new Lead({
        id: leadgen_id,
        personalDetails: leadPersonalDetails,
        owner: leadOwner,
        status: conditionDetails?.status || "Unallocated",
        subStatus: conditionDetails?.subStatus || "Left voicemail",
        source: conditionDetails?.source || "Referrals",
        subsource: conditionDetails?.subsource,
        projects: conditionDetails?.projects || [],
        hotLead: false,
        leadState: "active",
        createdOn: moment()
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DDTHH:mm:ss.000[Z]"),
        files: [],
        otherDetails: {
          __conversationStarted: false,
        },
      });

      const collectionPath = `Companies/${companyId}/leads`;
      await db
        .collection(collectionPath)
        .doc(leadgen_id)
        .set(newLead.toObject());

      // Create chatroom
      // await ChatroomService.addMessageToChatRoom(
      //   leadgen_id,
      //   companyId,
      //   "Lead Created Via Call"
      // );
      // const newChatRoom = createChatRoomModel([]);
      // await db
      //   .collection(`${collectionPath}/${leadgen_id}/Chatroom`)
      //   .doc(newChatRoom.id)
      //   .set(newChatRoom.toObject());

      // Add initial message
      // const createMessage = createChatMessage(
      //   companyName,
      //   companyId,
      //   "created lead"
      // );
      // const chatroomSnapshot = await db
      //   .collection(`${collectionPath}/${leadgen_id}/Chatroom`)
      //   .limit(1)
      //   .get();

      // if (!chatroomSnapshot.empty) {
      //   const firstDoc = chatroomSnapshot.docs[0];
      //   await db
      //     .collection(
      //       `${collectionPath}/${leadgen_id}/Chatroom/${firstDoc.id}/Messages`
      //     )
      //     .doc(createMessage.messageId)
      //     .set(createMessage.toObject());
      // }

      return {
        leadId: leadgen_id,
        clientName: clientName,
      };
    } catch (error) {
      console.error("Error creating lead:", error);
      throw error;
    }
  }

  async getLeadTempLeadName(companyId) {
    try {
      const querySnapshot = await db
        .collection("Companies")
        .doc(companyId)
        .collection("leads")
        .get();

      let documentCount = querySnapshot.size || 0;
      return (documentCount + 1).toString();
    } catch (error) {
      console.error("Error fetching document count:", error);
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
          await leadRef.update({ coOwners: coOwnerList });
        }
      } else {
        await leadRef.update({ coOwners: [] });
      }

      console.log("Co-owner operation completed successfully");
    } catch (error) {
      console.error("Error in co-owner operation:", error);
      throw error;
    }
  }

  async updateLeadOtherDetailsMap(companyId, leadId, value) {
    try {
      await db
        .collection("Companies")
        .doc(companyId)
        .collection("leads")
        .doc(leadId)
        .update({
          "otherDetails.__conversationStarted": value,
        });
    } catch (error) {
      console.error("Error updating lead other details:", error);
      throw error;
    }
  }
}

// Create and export singleton instance
const leadHelper = new LeadHelper();
module.exports = leadHelper;
