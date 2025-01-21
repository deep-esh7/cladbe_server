const admin = require("./admin");
const moment = require("moment-timezone");
const { CreateCallCollection } = require("./models/callCollection");
const { Lead, LeadPersonalDetails, LeadOwner } = require("./models/lead_model");
const {
  createChatRoomModel,
  createChatMessage,
} = require("./helpers/chathelper");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const Config = require("./config");

const db = admin.firestore();
const realtimeDb = admin.database();

// ChatroomService implementation
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

// Main endpoint handler
const fetchAgentData = async (req, res) => {
  try {
    console.log("Received request:", {
      body: req.body,
      method: req.method,
      url: req.url,
    });

    // Method validation
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Validate required fields
    const requiredFields = [
      "uuid",
      "call_to_number",
      "start_stamp",
      "call_id",
      "caller_id_number",
    ];
    const missingFields = requiredFields.filter((field) => !req.body[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

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

    let provider;

    try {
      const { companyId, provider: providerResponse } =
        await getCompanyIdAndProvider(callToNumber);
      provider = providerResponse;

      console.log("provider " + provider);
      console.log("companyId " + companyId);

      const leadData = await checkLeadExist(companyId, callerNumber);
      console.log("fetched lead data");
      console.log(leadData);

      var clientName;
      var destinationName;
      var destinationId;

      var destinationDetails = await fetchDestinationID(
        companyId,
        callToNumber
      );
      destinationId = destinationDetails.destinationID;
      destinationName = destinationDetails.destinationName;

      const employeeData = await fetchEmployeeData(
        companyId,
        leadData.ownerId || "",
        false
      );

      console.log("fetched employee data : ");
      console.log(employeeData);

      if (
        leadData !== "Lead Not Exist" &&
        leadData.leadState !== undefined &&
        leadData.leadState !== "inactive"
      ) {
        console.log("Handling existing active lead");
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
      } else {
        console.log("Handling new or inactive lead");
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
    } catch (error) {
      console.error("Error processing lead:", error);
      throw error;
    }
  } catch (error) {
    console.error("Error in fetchAgentData:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message,
      });
    }
  }
};

// Handlers for existing and new leads
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
    } else if (leadData.ownerName !== "") {
      const conditionDetails = await fetchConditions(
        companyId,
        destinationDetails.destinationName,
        destinationDetails.destinationID,
        true
      );

      if (conditionDetails.stickyAgent) {
        if (conditionDetails.fromThisTeamOnly) {
          await handleTeamCallRouting(
            companyId,
            leadData,
            conditionDetails,
            employeeData,
            callToNumber,
            callerNumber,
            callID,
            res
          );
        } else {
          await routeSingleCallsBasisOnConditions(
            companyId,
            res,
            conditionDetails,
            employeeData,
            leadData
          );
        }
      } else {
        await routeCall(
          companyId,
          callToNumber,
          callerNumber,
          callID,
          leadData.baseid,
          res,
          leadData
        );
      }
    }
  } catch (error) {
    console.error("Error in handleExistingLead:", error);
    throw error;
  }
}
async function getLeadTempLeadName(companyId) {
  try {
    const querySnapshot = await db
      .collection("Companies")
      .doc(companyId)
      .collection("leads")
      .get();

    var documentCount = querySnapshot.size;
    if (documentCount == 0 || documentCount == undefined) {
      documentCount = 0;
    }
    return (documentCount + 1).toString();
  } catch (error) {
    console.error("Error fetching document count: ", error);
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
  } catch (error) {
    console.error("Error in handleNewOrInactiveLead:", error);
    throw error;
  }
}

// Core helper functions
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

// Database helper functions
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

async function checkLeadExist(companyID, callerNumber) {
  try {
    if (!companyID || !callerNumber) {
      console.error(
        `Invalid inputs: companyID=${companyID}, callerNumber=${callerNumber}`
      );
      return null;
    }

    console.log(
      `Checking lead existence for company: ${companyID}, number: ${callerNumber}`
    );

    const mobileNoQuery = db
      .collection("Companies")
      .doc(companyID)
      .collection("leads")
      .where("personalDetails.mobileNo", "==", callerNumber);

    const phoneQuery = db
      .collection("Companies")
      .doc(companyID)
      .collection("leads")
      .where("personalDetails.phone", "==", callerNumber);

    let [mobileNoSnapshot, phoneSnapshot] = await Promise.all([
      mobileNoQuery.get(),
      phoneQuery.get(),
    ]);

    const mergedSnapshot = {
      empty: mobileNoSnapshot.empty && phoneSnapshot.empty,
      docs: [...mobileNoSnapshot.docs, ...phoneSnapshot.docs],
    };

    if (!mergedSnapshot.empty && mergedSnapshot.docs.length > 0) {
      const firstDoc = mergedSnapshot.docs[0];
      const doc = firstDoc.data();

      return {
        baseid: firstDoc.id,
        ownerId: doc.owner?.id || null,
        name: doc.personalDetails?.name || null,
        mobileNo: doc.personalDetails?.mobileNo || null,
        phone: doc.personalDetails?.phone || null,
        email: doc.personalDetails?.email || null,
        ownerName: doc.owner?.name || null,
        designation: doc.owner?.designation || null,
        leadState: doc.leadState || null,
        coOwners: doc.coOwners || [],
        leadStatusType: doc.leadStatusType || null,
        projectData: Array.isArray(doc.projects) ? doc.projects : [],
        leadStatus: doc.status || null,
        leadSubStatus: doc.subStatus || null,
        otherDetails: doc.otherDetails || null,
      };
    } else {
      return "Lead Not Exist";
    }
  } catch (error) {
    console.error("Error checking lead existence:", error);
    return null;
  }
}

// Additional helper functions
async function fetchDestinationID(companyID, callToNumber) {
  const doc = await db
    .collection("Companies")
    .doc(companyID)
    .collection("conversations")
    .doc("telephony")
    .collection("telephony")
    .doc(callToNumber)
    .get();
  const data = doc.data();

  return {
    destinationName: data.destination,
    destinationID: data.destinationID,
  };
}

async function fetchEmployeeData(companyID, employeeID, fullDetails) {
  if (!employeeID || employeeID === "") {
    return "Employee Not Found";
  }

  try {
    const snapshot = await db
      .collection("Companies")
      .doc(companyID)
      .collection("Employees")
      .where("id", "==", employeeID)
      .get();

    if (snapshot.empty) {
      return "Employee Not Found";
    }

    const doc = snapshot.docs[0];
    if (fullDetails === false) {
      if (doc.data().status === "available") {
        return doc.data().phoneNumber;
      } else {
        return "Agent Is Busy";
      }
    } else {
      return {
        number: doc.data().phoneNumber,
        designation: doc.data().designation,
        id: doc.data().id,
        name: doc.data().name,
        phoneNumber: doc.data().phoneNumber,
        deviceTokens: doc.data().deviceTokens,
      };
    }
  } catch (error) {
    console.error("Error in fetch");
  }
}

async function fetchConditions(
  companyId,
  destination,
  destinationID,
  fullDetails
) {
  let employeeList = [];
  let accessGroupList = [];
  let projectList = [];
  let employeeNumbersList = [];

  if (destination === "Employee") {
    return await fetchEmployeeData(companyId, destinationID, fullDetails);
  } else if (destination === "Conditions") {
    try {
      const doc = await db
        .collection("Companies")
        .doc(companyId)
        .collection("conversations")
        .doc("telephony")
        .collection("telephony")
        .doc("conditions")
        .collection("conditions")
        .doc(destinationID)
        .get();

      if (doc.exists && doc.data().conditionStatus === "isActive") {
        if (fullDetails === true) {
          return doc.data();
        }

        const data = doc.data();
        if (data.projectBlockList) {
          projectList = data.projectBlockList;
        }
        if (data.accessGroupList) {
          accessGroupList = data.accessGroupList;
        }

        if (data.employeeList) {
          employeeList = data.employeeList;
          employeeNumbersList = await Promise.all(
            employeeList.map(async (item) => ({
              data: await fetchEmployeeData(companyId, item.id, true),
            }))
          );
        }

        // Handle routing
        if (
          data.routing === "Round Robin (1 by 1)" ||
          data.routing === "Round Robin (Simultaneous)"
        ) {
          await updateEmployeeListToDB(
            data.routing,
            companyId,
            destinationID,
            employeeList
          );
        }

        return {
          phoneNumbers: employeeNumbersList,
          welcomeRecordingId: data.welcomeRecordingID || "",
          onHoldRecordingId: data.onHoldRecordingID || "",
          hangUpRecordingId: data.hangUpRecordingID || "",
          routing: data.routing,
          stickyAgent: data.stickyAgent,
          inActiveCallAsNewLead: data.inActiveLeadAsNewLead,
          callTransferToCoOwner: data.callTransferToCoOwner,
          subsource: data.subSource,
          source: data.source,
          subStatus: data.subStatus,
          status: data.status,
          projects: data.projects,
          fromThisTeamOnly: data.fromThisTeamOnly,
        };
      }
      return null;
    } catch (error) {
      console.error("Error in fetchConditions:", error);
      return null;
    }
  }
}

async function createLead(clientNumber, companyId, conditionDetails) {
  const leadgen_id = uuidv4();
  const companyName = "COMPANY_NAME";

  try {
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

    const clientName = await getLeadTempLeadName(companyId);

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
    await db.collection(collectionPath).doc(leadgen_id).set(newLead.toObject());

    await ChatroomService.addMessageToChatRoom(
      leadgen_id,
      companyId,
      "Lead Created Via Call"
    );

    const newChatRoom = createChatRoomModel([]);
    await db
      .collection(`${collectionPath}/${leadgen_id}/Chatroom`)
      .doc(newChatRoom.id)
      .set(newChatRoom.toObject());

    const createMessage = createChatMessage(
      companyName,
      companyId,
      "created lead"
    );
    const chatroomSnapshot = await db
      .collection(`${collectionPath}/${leadgen_id}/Chatroom`)
      .limit(1)
      .get();

    if (!chatroomSnapshot.empty) {
      const firstDoc = chatroomSnapshot.docs[0];
      await db
        .collection(
          `${collectionPath}/${leadgen_id}/Chatroom/${firstDoc.id}/Messages`
        )
        .doc(createMessage.messageId)
        .set(createMessage.toObject());
    }

    return {
      leadId: leadgen_id,
      clientName: clientName,
    };
  } catch (error) {
    console.error("Error creating lead:", error);
    throw error;
  }
}

async function routeCall(
  companyId,
  callToNumber,
  callerNumber,
  callID,
  baseId,
  res,
  leadData
) {
  try {
    await ChatroomService.addMessageToChatRoom(
      baseId,
      companyId,
      "Incoming Call Initiated By Customer"
    );

    const destinationDetails = await fetchDestinationBycallToNumber(
      companyId,
      callToNumber,
      callerNumber,
      callID,
      baseId
    );

    const updateRoutingCallLogs = new CreateCallCollection({
      routing: destinationDetails.routing,
      callId: callID,
      companyID: companyId,
    });

    await updateCallLogsToDb(updateRoutingCallLogs, "fetchAgentData");

    if (destinationDetails.type === "ivr") {
      return res.send([
        {
          transfer: {
            type: "ivr",
            data: destinationDetails.data,
          },
        },
      ]);
    }

    if (destinationDetails.type === "numbers") {
      const response = await constructNumbersResponse(
        destinationDetails,
        leadData,
        companyId,
        baseId
      );
      return res.send(response);
    }

    res.send([]);
  } catch (error) {
    console.error("Error in routeCall:", error);
    throw error;
  }
}

async function constructNumbersResponse(
  destinationDetails,
  leadData,
  companyId,
  baseId
) {
  const dataList = destinationDetails.data.filter((item) => item !== undefined);
  const response = [];

  if (destinationDetails.welcomeRecordingId?.trim()) {
    response.push({
      recording: {
        type: "system",
        data: destinationDetails.welcomeRecordingId,
      },
    });
  }

  const transfer = {
    transfer: {
      type: "number",
      data: dataList,
    },
  };

  if (dataList.length > 1) {
    transfer.transfer.ring_type =
      destinationDetails.routing === "Round Robin (Simultaneous)"
        ? "simultaneous"
        : "order_by";
  }

  if (destinationDetails.onHoldRecordingId?.trim()) {
    transfer.transfer.moh = destinationDetails.onHoldRecordingId;
  }

  response.push(transfer);

  return response;
}

// Export all functions
module.exports = {
  fetchAgentData,
  handleExistingLead,
  handleNewOrInactiveLead,
  getCompanyIdAndProvider,
  convertCallId,
  addCallLogsToDb,
  cleanObject,
  ChatroomService,
  checkLeadExist,
  fetchDestinationID,
  fetchEmployeeData,
  fetchConditions,
  createLead,
  routeCall,
};
