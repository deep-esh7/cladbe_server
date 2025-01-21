// Required imports
const admin = require("./admin");
const moment = require("moment-timezone");
const { CreateCallCollection } = require("./models/callCollection");
const { Lead, LeadPersonalDetails } = require("./models/lead_model");
const { v4: uuidv4 } = require("uuid");

const db = admin.firestore();
const realtimeDb = admin.database();

// Main function to fetch agent data when call is received
exports.fetchAgentData = onRequest((req, res) => {
  if (req.method === "POST") {
    const uuid = req.body.uuid.toString();
    let callToNumber = req.body.call_to_number.toString();

    // Convert startStamp to ISO format while maintaining Indian timezone
    const startStamp = moment(req.body.start_stamp)
      .tz("Asia/Kolkata")
      .toISOString();

    // Format phone numbers
    if (callToNumber.length > 10) {
      callToNumber = "91" + callToNumber.slice(-10);
    } else if (callToNumber.length === 10) {
      callToNumber = "91" + callToNumber;
    }

    const callID = convertCallId(req.body.call_id.toString());
    let callerNumber = req.body.caller_id_number.toString();

    if (callerNumber.length > 10) {
      callerNumber = "+91" + callerNumber.slice(-10);
    } else if (callerNumber.length === 10) {
      callerNumber = "+91" + callerNumber;
    }

    // Main call handling flow
    getCompanyIdAndProvider(callToNumber)
      .then(async ({ companyId, provider }) => {
        const leadData = await checkLeadExist(companyId, callerNumber);
        return { leadData, companyId, provider };
      })
      .then(async ({ leadData, companyId, provider }) => {
        // Get destination details
        const destinationDetails = await fetchDestinationID(
          companyId,
          callToNumber
        );
        const employeeData = await fetchEmployeeData(
          companyId,
          leadData.ownerId,
          false
        );

        // Handle existing active lead
        if (
          leadData !== "Lead Not Exist" &&
          leadData.leadState !== undefined &&
          leadData.leadState !== "inactive"
        ) {
          await handleExistingLead(
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
          );
        }
        // Handle new or inactive lead
        else {
          await handleNewOrInactiveLead(
            leadData,
            companyId,
            destinationDetails,
            provider,
            callID,
            callToNumber,
            startStamp,
            callerNumber,
            res
          );
        }
      })
      .catch((error) => {
        console.error("Error:", error);
        res.status(500).send("Internal Server Error");
      });
  }
});

// Helper function to handle existing leads
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
  await ChatroomService.addMessageToChatRoom(
    leadData.baseid,
    companyId,
    `Incoming Call Initiated By Customer : ${leadData.name
      .toString()
      .toUpperCase()}`
  );

  const callData = new CreateCallCollection({
    companyID: companyId,
    callDirection: "inbound",
    destinationID: destinationDetails.destinationID,
    destinationName: destinationDetails.destinationName,
    provider: provider,
    incomingAgentMobileNumber: employeeData,
    agentName: leadData.ownerName,
    agentDesignation: leadData.designation,
    agentid: leadData.ownerId,
    callId: callID,
    baseID: leadData.baseid,
    incomingCallDid: callToNumber,
    callStartStamp: startStamp,
    leadStatusType: "Fresh",
    currentCallStatus: "Started",
    incomingCallerMobileNumber: callerNumber,
    isSmsSent: "false",
    callNotes: "Not Available",
    clientName: leadData.name,
    routing: "No Routing",
  });

  await addCallLogsToDb(callData);

  if (leadData.ownerName === "") {
    await routeCall(
      companyId,
      callToNumber,
      callerNumber,
      callID,
      leadData.baseid,
      res,
      leadData
    );
  } else {
    await handleExistingOwner(
      companyId,
      destinationDetails,
      leadData,
      employeeData,
      callToNumber,
      callerNumber,
      callID,
      res
    );
  }
}

// Helper function to handle new or inactive leads
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
  let baseId, clientName, leadStatusType;

  if (leadData.leadState === "inactive") {
    baseId = leadData.baseid;
    clientName = leadData.name;
    leadStatusType = "Interested";

    await ChatroomService.addMessageToChatRoom(
      baseId,
      companyId,
      `Lead Marked As Active Again From InActive : ${clientName
        .toString()
        .toUpperCase()}`
      //empty
    );
  } else {
    const conditionDetails = await fetchConditions(
      companyId,
      destinationDetails.destinationName,
      destinationDetails.destinationID,
      true
    );

    const leadDetails = await createLead(
      callerNumber,
      companyId,
      conditionDetails
    );
    baseId = leadDetails.leadId;
    clientName = leadDetails.clientName;
    leadStatusType = "Unallocated";
  }

  const callData = new CreateCallCollection({
    companyID: companyId,
    callDirection: "inbound",
    destinationID: destinationDetails.destinationID,
    destinationName: destinationDetails.destinationName,
    provider: provider,
    agentName: "",
    agentDesignation: "",
    agentid: "",
    callId: callID,
    baseID: baseId,
    incomingCallerMobileNumber: callerNumber,
    incomingCallDid: callToNumber,
    callStartStamp: startStamp,
    leadStatusType: leadStatusType,
    currentCallStatus: "Started",
    isSmsSent: "false",
    callNotes: "Not Available",
    clientName: clientName,
    routing: "No Routing",
  });

  await addCallLogsToDb(callData);
  await routeCall(
    companyId,
    callToNumber,
    callerNumber,
    callID,
    baseId,
    res,
    leadData
  );
}

// Core helper functions
async function getCompanyIdAndProvider(callToNumber) {
  return new Promise((resolve, reject) => {
    db.collection("masterCollection")
      .doc("didNumbers")
      .collection("didNumbers")
      .where("didNumber", "==", callToNumber)
      .get()
      .then((querySnapshot) => {
        querySnapshot.forEach((doc) => {
          if (doc.data().didStatus == "active") {
            resolve({
              companyId: doc.data().assignedToCompanyId,
              provider: doc.data().provider,
            });
          }
        });
        reject("No allocated company found for this number.");
      })
      .catch(reject);
  });
}

// Function to convert call ID format
function convertCallId(callId) {
  return callId.replaceAll(".", "_");
}

// Function to add call logs to database
async function addCallLogsToDb(callLogs) {
  try {
    const path = `/Companies/${callLogs.companyID}/conversations/telephony/call collection/${callLogs.callId}`;
    await realtimeDb.ref(path).set(cleanObject(callLogs));
    console.log("Call logs created successfully");
  } catch (error) {
    console.error("Error adding call logs:", error);
  }
}

// Utility function to clean object
function cleanObject(obj) {
  const cleanObj = {};
  for (let key in obj) {
    if (typeof obj[key] !== "undefined") {
      cleanObj[key] = obj[key];
    }
  }
  return cleanObj;
}
