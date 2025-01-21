const admin = require("./admin");
const moment = require("moment-timezone");
const { CreateCallCollection } = require("./models/callCollection");
const { Lead, LeadPersonalDetails } = require("./models/lead_model");
const { v4: uuidv4 } = require("uuid");

const db = admin.firestore();
const realtimeDb = admin.database();

// Create ChatroomService class/object
const ChatroomService = {
  addMessageToChatRoom: async (baseId, companyId, message) => {
    try {
      const chatroomSnapshot = await db
        .collection(`Companies/${companyId}/leads/${baseId}/Chatroom`)
        .limit(1)
        .get();

      if (!chatroomSnapshot.empty) {
        const firstDoc = chatroomSnapshot.docs[0];
        const messageId = uuidv4();
        await db
          .collection(
            `Companies/${companyId}/leads/${baseId}/Chatroom/${firstDoc.id}/Messages`
          )
          .doc(messageId)
          .set({
            message: message,
            timestamp: moment().tz("Asia/Kolkata").toISOString(),
            type: "system",
          });
      }
    } catch (error) {
      console.error("Error adding message to chatroom:", error);
    }
  },
};

// Helper Functions
function cleanObject(obj) {
  const cleanObj = {};
  for (let key in obj) {
    if (typeof obj[key] !== "undefined") {
      cleanObj[key] = obj[key];
    }
  }
  return cleanObj;
}

function convertCallId(callId) {
  return callId.replaceAll(".", "_");
}

async function getCompanyIdAndProvider(callToNumber) {
  return new Promise((resolve, reject) => {
    db.collection("masterCollection")
      .doc("didNumbers")
      .collection("didNumbers")
      .where("didNumber", "==", callToNumber)
      .get()
      .then((querySnapshot) => {
        let found = false;
        querySnapshot.forEach((doc) => {
          if (doc.data().didStatus === "active") {
            found = true;
            resolve({
              companyId: doc.data().assignedToCompanyId,
              provider: doc.data().provider,
            });
          }
        });
        if (!found) {
          reject(new Error("No allocated company found for this number"));
        }
      })
      .catch(reject);
  });
}

async function addCallLogsToDb(callLogs) {
  try {
    const path = `/Companies/${callLogs.companyID}/conversations/telephony/call collection/${callLogs.callId}`;
    await realtimeDb.ref(path).set(cleanObject(callLogs));
    console.log("Call logs created successfully");
  } catch (error) {
    console.error("Error adding call logs:", error);
    throw error;
  }
}

// Handlers
async function handleExistingLead(
  leadData,
  companyId,
  destinationDetails,
  provider,
  employeeData,
  callID,
  callToNumber,
  startStamp,
  callerNumber,
  res
) {
  try {
    // ... rest of the handler code ...
  } catch (error) {
    console.error("Error in handleExistingLead:", error);
    throw error;
  }
}

async function handleNewOrInactiveLead(
  leadData,
  companyId,
  destinationDetails,
  provider,
  callID,
  callToNumber,
  startStamp,
  callerNumber,
  res
) {
  try {
    // ... rest of the handler code ...
  } catch (error) {
    console.error("Error in handleNewOrInactiveLead:", error);
    throw error;
  }
}

// Main endpoint handler
const fetchAgentData = async (req, res) => {
  try {
    // Method validation
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // ... rest of the endpoint code ...
  } catch (error) {
    console.error("Error in fetchAgentData:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
};

// Export all functions at once
module.exports = {
  fetchAgentData,
  handleExistingLead,
  handleNewOrInactiveLead,
  getCompanyIdAndProvider,
  convertCallId,
  addCallLogsToDb,
  cleanObject,
  ChatroomService,
};
