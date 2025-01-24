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

      if (conditionDetails.stickyAgent == true) {
        if (conditionDetails.fromThisTeamOnly == true) {
          const employeeList = conditionDetails.employeeList;

          if (
            employeeList.some((employee) => employee.id === leadData.ownerId) ==
            true
          ) {
            routeSingleCallsBasisOnConditions(
              companyId,
              res,
              conditionDetails,
              employeeData,
              leadData
            );
          } else if (
            conditionDetails["callTransferToCoOwner"] == true &&
            employeeList.some(
              (employee) => employee.id === leadData.coOwners.id
            )
          ) {
            const matchingEmployee = employeeList.find(
              (employee) => employee.id === leadData.coOwners.id
            );

            if (matchingEmployee) {
              const employeeId = matchingEmployee.id;
              console.log(`Found employee with ID ${employeeId}`);

              const coOwnerAllDetails = fetchEmployeeData(
                companyId,
                employeeId,
                true
              );

              routeSingleCallsBasisOnConditions(
                companyId,
                res,
                conditionDetails,
                coOwnerAllDetails.number,
                leadData
              );
            } else {
              console.log(`No employee found with ID ${leadData.coOwners.id}`);
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

async function routeSingleCallsBasisOnConditions(
  companyId,
  res,
  conditionDetails,
  employeeData,
  leadData
) {
  console.log(employeeData + "fajjlsdfjkljkl");
  console.log(leadData);

  // Get project name
  const projectName =
    Array.isArray(leadData.projectData) && leadData.projectData.length > 0
      ? leadData.projectData[0]?.name || ""
      : "";

  // Send notification to first agent
  triggerNotification(
    {
      notificationType: "inboundCall",
      projectName: projectName,
      clientName: leadData.name,
      clientNumber: leadData.mobileNo,
      leadStatus: leadData.leadStatus,
      leadSubStatus: leadData.leadSubStatus,
      baseId: leadData.baseid,
      companyId: companyId,
    },
    companyId,
    leadData.ownerId
  );

  // Fetch recording IDs if they exist and are not empty
  let welcomeRecordingId = "";
  let onHoldRecordingId = "";

  if (
    conditionDetails.welcomeRecordingID &&
    conditionDetails.welcomeRecordingID.trim() !== ""
  ) {
    welcomeRecordingId = await fetchTataRecordingIdByRecordingIdDoc(
      companyId,
      conditionDetails.welcomeRecordingID
    );
  }

  if (
    conditionDetails.onHoldRecordingID &&
    conditionDetails.onHoldRecordingID.trim() !== ""
  ) {
    onHoldRecordingId = await fetchTataRecordingIdByRecordingIdDoc(
      companyId,
      conditionDetails.onHoldRecordingID
    );
  }

  console.log(onHoldRecordingId);

  // Prepare response array
  const response = [];

  // Add welcome recording if exists and is not empty
  if (welcomeRecordingId && welcomeRecordingId.trim() !== "") {
    response.push({
      recording: {
        type: "system",
        data: welcomeRecordingId,
      },
    });
  }

  // Add transfer with optional moh
  const transfer = {
    transfer: {
      type: "number",
      data: [employeeData],
    },
  };

  // Add moh only if onHoldRecordingId exists and is not empty
  if (onHoldRecordingId && onHoldRecordingId.trim() !== "") {
    transfer.transfer.moh = onHoldRecordingId;
  }

  response.push(transfer);

  console.log("final response sent to tata api ");

  console.log(JSON.stringify(response));

  res.send(response);
}

async function fetchDestinationBycallToNumber(
  companyId,
  callToNumber,
  callerNumber,
  callID,
  leadID
) {
  try {
    const doc = await db
      .collection("Companies")
      .doc(companyId)
      .collection("conversations")
      .doc("telephony")
      .collection("telephony")
      .doc(callToNumber)
      .get();

    if (doc.exists) {
      const data = doc.data();
      if (data.isActive) {
        const destination = data.destination;
        const destinationID = data.destinationID;
        let employeeName;
        let employeeDesignation;
        let employeeId;
        let employeeMobileNumber;
        const employeeDataMap = new Map();
        const employeeIdList = [];
        const employeeMobileNumberList = [];
        var stickyAgent;

        var otherDetails;

        console.log(destination + " saddsajhads");

        if (destination === "Conditions") {
          // Return a map with available employee list
          const conditionDetails = await fetchConditions(
            companyId,
            destination,
            destinationID,
            false
          );

          // console.log("Lead Details: ", leadDetails);

          console.log("Condition Details: ", JSON.stringify(conditionDetails));

          const employeeDetails = conditionDetails["phoneNumbers"];

          console.log(JSON.stringify(employeeDetails));

          stickyAgent = conditionDetails["stickyAgent"];

          // Assuming employeeDetails is an array of objects
          employeeDetails.forEach((employee) => {
            if (!employeeName) {
              // Set initial employee details
              employeeName = employee["data"].name;
              employeeDesignation = employee["data"].designation;
              employeeMobileNumber = employee["data"].phoneNumber;
              employeeId = employee["data"].id;
            }

            console.log(employeeName + " - id to print hora h");

            // Populate employeeDataMap with phoneNumber as key and array of details as value
            employeeDataMap.set(employee["data"].phoneNumber, [
              employee["data"].name,
              employee["data"].id,
              employee["data"].designation,
            ]);

            // Populate lists with employee id and phoneNumber
            employeeIdList.push(employee["data"].id);
            employeeMobileNumberList.push(employee["data"].phoneNumber);
          });

          // Logging keys and values from employeeDataMap
          employeeDataMap.forEach((value, key) => {
            console.log(key + " -> " + JSON.stringify(value));
          });

          // Create call logs instance
          const callLogs = new CreateCallCollection({
            companyID: companyId,
            agentid: employeeId,
            agentName: employeeName,
            agentDesignation: employeeDesignation,
            incomingAgentMobileNumber: employeeMobileNumber,
            destinationID: destinationID,
            baseID: leadID,
            callId: callID,
            agentIDs: employeeIdList,
            leadStatusType: "Fresh",
            stickyAgent: stickyAgent,
          });

          console.log("Call ID from fetch agent data: " + callID.toString());

          console.log(
            "BEFORE SENDING MAP FULL MAP " +
              JSON.stringify([...employeeDataMap])
          );

          console.log("lead id yaha par : " + leadID);
          const leadData = await checkLeadExist(companyId, callerNumber);

          var deleteCoOwners;
          console.log("Before accessing conditionDetails");
          console.log("conditionDetails:", conditionDetails);

          var inActiveCallAsNewLead = conditionDetails.inActiveCallAsNewLead;

          var projects;

          if (
            conditionDetails &&
            conditionDetails.inActiveCallAsNewLead !== undefined
          ) {
            console.log(
              "yaha pr phcha " +
                leadData.leadState +
                " lead state, inactive : " +
                conditionDetails.inActiveCallAsNewLead
            );
          } else {
            console.log(
              "conditionDetails or inActiveCallAsNewLead is undefined or null."
            );
          }

          console.log(
            "After accessing conditionDetails " + inActiveCallAsNewLead
          );
          if (
            leadData.leadState == "inactive" &&
            inActiveCallAsNewLead == true
          ) {
            deleteCoOwners = true;

            //if lead is inactive so we are making it active also we are overriding its preexisting data like owner , deletingn coowner , and overriding source , subsource , status  , substatus type by sending in other details

            otherDetails = {
              status: conditionDetails.status,
              subStatus: conditionDetails.subStatus,
              source: conditionDetails.source,
              subsource: conditionDetails.subsource,
            };

            projects = conditionDetails.projects;

            addOwnerAndCoOwner([], companyId, leadID, deleteCoOwners);
            stickyAgent = false;
          } else {
            deleteCoOwners = false;
          }

          if (leadData.ownerId == "") {
            stickyAgent = false;
          }

          hitLiveCallCheckApiWithEmployeeData(
            companyId,
            employeeDataMap,
            employeeMobileNumberList,
            callID,
            leadID,
            stickyAgent,
            deleteCoOwners
            // destinationID,
            // destination
          );

          // Your existing code for hitting live check API
          updateCallLogsToDb(callLogs, "fetchAgentData");

          // this function checkes wether it is a very first call of lead as owner not assigned yet so we mmark sticky agent as false the owner can get assigned to it

          updateLeadData(
            companyId,
            employeeId,
            employeeName,
            employeeDesignation,
            leadID,
            stickyAgent,
            deleteCoOwners,
            otherDetails,
            projects

            // destinationID,
            // destination
          );

          console.log(JSON.stringify(conditionDetails));
          var welcomeRecording;
          var onHoldRecording;

          if (conditionDetails["welcomeRecordingId"] != "") {
            welcomeRecording = await fetchTataRecordingIdByRecordingIdDoc(
              companyId,
              conditionDetails["welcomeRecordingId"]
            );
          } else {
            welcomeRecording = "";
          }

          if (conditionDetails["onHoldRecordingId"] != "") {
            onHoldRecording = await fetchTataRecordingIdByRecordingIdDoc(
              companyId,
              conditionDetails["onHoldRecordingId"]
            );
          } else {
            onHoldRecording = "";
          }

          if (welcomeRecording === "") {
            // welcomeRecording = "146393";
            welcomeRecording = "";
          }
          if (onHoldRecording === "") {
            // onHoldRecording = "146393";
            onHoldRecording = "";
          }

          return {
            type: "numbers",
            welcomeRecordingId: welcomeRecording,
            onHoldRecordingId: onHoldRecording,
            hangUpRecordingId: conditionDetails["hangUpRecordingId"],
            data: employeeMobileNumberList,
            routing: conditionDetails["routing"],
          };
        } else if (destination === "IVR") {
          // Fetch IVR Details
        } else if (destination === "Employee") {
          const employeeDetails = await fetchConditions(
            companyId,
            destination,
            destinationID,
            true
          );

          console.log("Lead ID: ", leadID);

          // Create call logs instance
          const callLogs = new CreateCallCollection({
            companyID: companyId,
            agentid: employeeDetails.id,
            agentName: employeeDetails.name,
            agentDesignation: employeeDetails.designation,
            incomingAgentMobileNumber: employeeDetails.phoneNumber,
            destination: "Employee",
            destinationID: employeeDetails.id,
            baseID: leadID,
            callId: callID,
          });

          updateCallLogsToDb(callLogs, "fetchAgentData");

          updateLeadData(
            companyId,
            employeeDetails.id,
            employeeDetails.name,
            employeeDetails.designation,
            leadID,
            false
            // destinationID,
            // destination
          );

          // Default recording for employee
          return {
            type: "numbers",
            data: employeeDetails.phoneNumber,
            welcomeRecordingId: "",
            onHoldRecordingId: "146393",
            hangUpRecordingId: "",
          };
          // Fetch employee id
        }
      } else {
        // Send hangup status and recording as this number is temporarily out of service
      }
    } else {
      // Document doesn't exist
    }
  } catch (error) {
    console.error("Error occurred:", error);
    // Handle error appropriately
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

async function updateEmployeeListToDB(
  routing,
  companyId,
  conditionID,
  listOfEmployees
) {
  // Guard against empty list
  if (!listOfEmployees || listOfEmployees.length === 0) {
    console.log("No employees to rotate");
    return;
  }

  let rotatedEmployeesList;

  // Function to perform one-step circular rotation
  function circularRotateOneStep(arr) {
    // Take first element and move it to end
    const rotated = [...arr.slice(1), arr[0]];
    return rotated;
  }

  if (routing == "Round Robin (1 by 1)") {
    // Simple one-step rotation: [1,2,3,4] becomes [2,3,4,1]
    rotatedEmployeesList = circularRotateOneStep(listOfEmployees);
    console.log("One step rotation result:", rotatedEmployeesList);
  }

  if (routing == "Round Robin (Simultaneous)") {
    // Split the list into two equal parts
    const middleIndex = Math.floor(listOfEmployees.length / 2);
    const firstHalf = listOfEmployees.slice(0, middleIndex);
    const secondHalf = listOfEmployees.slice(middleIndex);

    // Rotate each half one step
    const rotatedFirstHalf = circularRotateOneStep(firstHalf);
    const rotatedSecondHalf = circularRotateOneStep(secondHalf);

    // Combine the rotated halves alternately
    rotatedEmployeesList = [];
    for (
      let i = 0;
      i < Math.max(rotatedFirstHalf.length, rotatedSecondHalf.length);
      i++
    ) {
      if (i < rotatedFirstHalf.length) {
        rotatedEmployeesList.push(rotatedFirstHalf[i]);
      }
      if (i < rotatedSecondHalf.length) {
        rotatedEmployeesList.push(rotatedSecondHalf[i]);
      }
    }

    console.log("Original list:", listOfEmployees);
    console.log("Rotated list:", rotatedEmployeesList);
  }

  try {
    await db
      .collection("Companies")
      .doc(companyId)
      .collection("conversations")
      .doc("telephony")
      .collection("telephony")
      .doc("conditions")
      .collection("conditions")
      .doc(conditionID)
      .update({
        employeeList: rotatedEmployeesList,
      });

    console.log("List updated successfully in database");
  } catch (error) {
    console.error("Error updating list:", error);
  }
}

async function updateCallLogsToDb(callLogs, webHookType, fileUrl) {
  const cleanCallLogs = cleanObject(callLogs);

  try {
    // Construct the path in Realtime Database
    const path = `/Companies/${cleanCallLogs.companyID}/conversations/telephony/call collection/${cleanCallLogs.callId}`;

    // Update data
    await realtimeDb.ref(path).update(cleanCallLogs);

    console.log("Update completed.");

    if (webHookType === "callAnsweredByAgent") {
      console.log(
        "Call logs updated as received by callAnsweredByAgent Webhook"
      );
    } else if (webHookType === "fetchAgentData") {
      console.log("Employee details updated as received by AgentData Webhook");
    } else {
      console.log("Call logs updated as received by HangUp Webhook");

      // Example logic to upload file to Firebase Storage after 20 seconds
      const filePath = `Companies/${cleanCallLogs.companyID}/conversations/telephony/callRecordings/${cleanCallLogs.callId}`;
      console.log("file url before snding uploading : " + fileUrl);
      setTimeout(() => {
        uploadFile(cleanCallLogs.callId + ".mp3", fileUrl, filePath).then(
          (uploadResponseData) => {
            // Update Realtime Database with the recording link
            realtimeDb.ref(path).update({
              recordingLink: getAppDocument(
                uploadResponseData.name,
                uploadResponseData.documentPath,
                uploadResponseData.hashingCode,
                uploadResponseData.bucketName,
                uploadResponseData.bucketProvider,
                uploadResponseData.previewDocumentPath,
                uploadResponseData.previewHashingCode
              ), // Update the recording link in Realtime Database
            });
          }
        );
      }, 30000);
    }
  } catch (error) {
    console.error("Error updating call logs:", error);
  }
}

async function updateLeadData(
  companyID,
  agentID,
  agentName,
  agentDesignation,
  leadID,
  stickyAgent,
  deleteCoOwners,
  otherDetails,
  projects
  // destinationFromId,
  // destinationFromName
) {
  console.log("updateLeadDataFunction");
  console.log(
    companyID + " " + agentID + " " + agentDesignation + " " + leadID + " "
  );

  if (stickyAgent == false) {
    var status;
    var destinationfromid;
    var destinationfromname;
    if (agentID == "") {
      status = "Unallocated";
    } else {
      status = "Fresh";
    }

    // if (destinationFromId == undefined) {
    //   destinationfromid = "";
    // } else {
    //   destinationfromid = destinationFromId;
    // }

    // if (destinationFromName == undefined) {
    //   destinationfromname = "";
    // } else {
    //   destinationfromname = destinationFromName;
    // }

    if (otherDetails != undefined) {
      // update lead with other details also
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

          // destinationFromId: destinationfromid,
          // destinationFromName: destinationfromname,
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
          // destinationFromId: destinationfromid,
          // destinationFromName: destinationfromname,
        });
    }
  } else {
    const coOwner = {
      id: agentID,
      designation: agentDesignation,
      name: agentName,
    };

    addOwnerAndCoOwner(coOwner, companyID, leadID, deleteCoOwners);
  }
}

async function addOwnerAndCoOwner(
  coOwnerDetails,
  companyId,
  leadId,
  deleteCoOwners
) {
  try {
    const leadRef = db
      .collection("Companies")
      .doc(companyId)
      .collection("leads")
      .doc(leadId);

    if (deleteCoOwners == undefined || deleteCoOwners == false) {
      var coOwnerList = await getCoOwnerList(companyId, leadId);

      if (
        coOwnerList.some((coOwner) => coOwner.id === coOwnerDetails.id) == false
      ) {
        coOwnerList.push(coOwnerDetails);

        leadRef.update({
          coOwners: coOwnerList,
        });
      }
    } else {
      var newcoOwnerList = [];

      leadRef.update({
        coOwners: newcoOwnerList,
      });
    }

    console.log("Co-owner added successfully");
  } catch (error) {
    console.error("Error adding co-owner: ", error);
  }
}
async function fetchTataRecordingIdByRecordingIdDoc(companyId, audioFileId) {
  try {
    // Use await to fetch document from Firestore
    const doc = await db
      .collection("Companies")
      .doc(companyId)
      .collection("conversations")
      .doc("telephony")
      .collection("audioFiles")
      .doc(audioFileId)
      .get();

    // Check if the document exists
    if (!doc.exists) {
      throw new Error(`Audio file with ID ${audioFileId} not found`);
    }

    // Access recordingIdForTata from the document data
    const recordingIdForTata = doc.data().recordingIdForTata;

    console.log(`${recordingIdForTata} : audio file id`);

    // Return the recordingIdForTata
    return recordingIdForTata;
  } catch (error) {
    console.error("Error fetching Tata recording ID:", error);
    throw error; // Rethrow the error for handling higher up the call stack
  }
}

async function getCoOwnerList(companyId, leadId) {
  try {
    const leadRef = db
      .collection("Companies")
      .doc(companyId)
      .collection("leads")
      .doc(leadId);
    const doc = await leadRef.get();

    if (!doc.exists) {
      throw new Error("Lead document not found");
    }

    const leadData = doc.data();
    const coOwners = leadData.coOwners || [];

    return coOwners;
  } catch (error) {
    console.error("Error getting co-owners: ", error);
    throw error;
  }
}

async function hitLiveCallCheckApiWithEmployeeData(
  companyId,
  employeeDataMap,
  employeeMobileNumberList,
  callId,
  leadId,
  stickyAgent,
  deleteCoOwners
) {
  console.log(leadId + " - Lead ID");

  let taskCompleted = "no";

  const apiUrl = `https://api-smartflo.tatateleservices.com/v1/live_calls?call_id=${callId}`;
  const token = "Bearer " + Config.EnvKeys.tataCalls;

  async function makeApiCall() {
    try {
      const response = await axios.get(apiUrl, {
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
      });

      const responseData = response.data;
      console.log("API Response:", responseData);

      if (
        responseData.length === 0 ||
        responseData === null ||
        responseData === undefined ||
        responseData.length === 0
      ) {
        if (taskCompleted === "no") {
          console.log("Stopping further API calls");
          return;
        }
      } else {
        const firstCall = responseData[0];

        if (firstCall) {
          console.log(
            JSON.stringify(firstCall) + " - Details of the first call"
          );
          console.log(
            JSON.stringify(employeeMobileNumberList[0]) +
              " - Current employee details"
          );

          console.log(firstCall.destination + " - Call destination");
          if (
            firstCall.destination &&
            firstCall.destination !== "" &&
            firstCall.destination !== " " &&
            firstCall.destination !== null &&
            firstCall.destination !== employeeMobileNumberList[0]
          ) {
            console.log("First block");
            if (employeeMobileNumberList.length > 0) {
              console.log("Second block");
              employeeMobileNumberList = employeeMobileNumberList.slice(1);

              console.log(
                "Full employee map: " + JSON.stringify([...employeeDataMap])
              );

              console.log(
                "Employee map after slice: " +
                  JSON.stringify(employeeDataMap.get(firstCall.destination))
              );

              const employeeDetails = employeeDataMap.get(
                firstCall.destination
              );

              if (employeeDetails) {
                const agentName = employeeDetails[0];
                const agentId = employeeDetails[1];
                const agentDesignation = employeeDetails[2];

                console.log(
                  "Agent details: " +
                    agentId +
                    " " +
                    agentName +
                    " " +
                    agentDesignation
                );

                const callLogs = new CreateCallCollection({
                  companyID: companyId,
                  callId: callId,
                  agentid: agentId,
                  agentName: agentName,
                  agentDesignation: agentDesignation,
                  incomingAgentMobileNumber: firstCall.destination,
                  leadStatusType: "Fresh",
                });

                updateLeadData(
                  companyId,
                  agentId,
                  agentName,
                  agentDesignation,
                  leadId,
                  stickyAgent,
                  deleteCoOwners
                  // destinationId,
                  // destinationName
                );
                updateCallLogsToDb(callLogs, "fetchAgentData");
              } else {
                console.log(
                  `Employee details not found for destination: ${firstCall.destination}`
                );
              }
            }
          }
        } else {
          console.error("API response is empty or undefined");
        }

        console.log("State:", firstCall.state);
      }

      setTimeout(makeApiCall, 5000); // Call the function again after 5 seconds
    } catch (error) {
      console.error("Error fetching API:", error.message);
    }
  }

  console.log(leadId + " - Initial Lead ID");
  makeApiCall(); // Initial call to start the recursive API calling
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
