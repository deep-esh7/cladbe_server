const moment = require("moment-timezone");

const employeeHelper = require("../Helpers/EmployeeHelper");
const leadHelper = require("../Helpers/LeadHelper");
const callLogsHelper = require("../Helpers/CallLogHelper");
const companyHelper = require("../Helpers/CompanyHelper");
const tataCallingHelpers = require("../tataCalling/tataCallingHelpers/TataCallingHelpers");
const callHandler = require("../tataCalling/tataCallingHelpers/CallHandler");
const { CreateCallCollection } = require("./models/callCollection");
// const ChatroomService = require("../Services/ChatroomService");

async function callAnsweredByAgent(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Error: Only POST requests are allowed");
  }

  try {
    console.log("Call answered webhook payload:", JSON.stringify(req.body));
    const callData = await processCallData(req.body);

    const { companyId, provider } = await companyHelper.getCompanyIdAndProvider(
      callData.callToNumber
    );

    const [agentDetails, leadDetails] = await Promise.all([
      fetchAgentDetails(companyId, callData.answeredAgentNo),
      fetchLeadDetails(companyId, callData.callerNumber),
    ]);

    // Handle inbound call specifics
    if (callData.direction !== "outbound") {
      await handleInboundCall(companyId, callData, agentDetails, leadDetails);
    }

    // Create call collection
    const callCollection = await createCallCollection(
      companyId,
      provider,
      callData,
      agentDetails,
      leadDetails
    );

    // Update call logs
    await handleCallLogs(callData.direction, callCollection);

    // Add chatroom message
    await addChatroomMessage(
      leadDetails,
      companyId,
      callData.direction,
      agentDetails.name
    );

    res.status(200).send("Call answered by agent data updated successfully.");
  } catch (error) {
    console.error("Error in callAnsweredByAgent:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: error.stack,
    });
  }
}

async function processCallData(body) {
  const {
    uuid,
    call_to_number,
    direction,
    call_id,
    caller_id_number,
    answer_agent_number,
    call_status,
    missed_agent,
  } = body;

  let callToNumber = call_to_number;
  let callerNumber = caller_id_number;
  let callDirection = direction;

  // Format numbers using helper functions
  if (direction === "click_to_call") {
    callToNumber = callHandler.formatIndianNumberWithoutPlus(caller_id_number);
    callerNumber = "+" + call_to_number;
    callDirection = "outbound";
  } else {
    callToNumber = callHandler.formatIndianNumberWithoutPlus(call_to_number);
    callerNumber = callHandler.formatIndianNumberWithPlus(caller_id_number);
  }

  const answeredAgentNo = callHandler.formatAgentNumber(
    answer_agent_number,
    call_status,
    direction,
    missed_agent
  );

  return {
    uuid: uuid.toString(),
    callToNumber,
    direction: callDirection,
    callId: tataCallingHelpers.convertCallId(call_id),
    callerNumber,
    answeredAgentNo,
    callStatus: call_status,
    timestamp: moment().tz("Asia/Kolkata").format("YYYY-MM-DDTHH:mm:ss.000[Z]"),
  };
}

async function fetchAgentDetails(companyId, agentNumber) {
  const agentDetails = await employeeHelper.fetchEmployeeDataByNumber(
    companyId,
    agentNumber
  );
  if (agentDetails === "Employee Not Found") {
    throw new Error("Agent not found");
  }
  return agentDetails;
}

async function fetchLeadDetails(companyId, callerNumber) {
  return await leadHelper.checkLeadExist(companyId, callerNumber);
}

async function handleInboundCall(
  companyId,
  callData,
  agentDetails,
  leadDetails
) {
  if (leadDetails === "Lead Not Exist") return;

  // Get destination details
  const destinationDetails = await tataCallingHelpers.fetchDestinationID(
    companyId,
    callData.callToNumber
  );
  const conditions = await tataCallingHelpers.fetchConditions(
    companyId,
    destinationDetails.destinationName,
    destinationDetails.destinationID,
    true
  );

  // Update conversation started status
  if (leadDetails.otherDetails?.__conversationStarted === false) {
    await leadHelper.updateLeadOtherDetailsMap(
      companyId,
      leadDetails.baseid,
      true
    );
  }

  // Handle lead status updates
  if (!leadDetails.ownerId) {
    await updateLeadOwner(companyId, agentDetails, leadDetails, conditions);
  } else if (leadDetails.leadState === "inactive") {
    await handleInactiveLead(companyId, agentDetails, leadDetails);
  } else if (shouldUpdateLeadOwner(leadDetails, agentDetails, conditions)) {
    await updateLeadOwner(companyId, agentDetails, leadDetails, conditions);
  }
}

async function updateLeadOwner(
  companyId,
  agentDetails,
  leadDetails,
  conditions
) {
  await leadHelper.updateLeadData(
    companyId,
    agentDetails.id,
    agentDetails.name,
    agentDetails.designation,
    leadDetails.baseid,
    conditions?.stickyAgent || false
  );
}

async function handleInactiveLead(companyId, agentDetails, leadDetails) {
  await leadHelper.updateLeadState(companyId, leadDetails.baseid);
  await leadHelper.updateLeadData(
    companyId,
    agentDetails.id,
    agentDetails.name,
    agentDetails.designation,
    leadDetails.baseid,
    false
  );
}

function shouldUpdateLeadOwner(leadDetails, agentDetails, conditions) {
  return (
    leadDetails.ownerId !== agentDetails.id &&
    conditions?.routing === "Round Robin (Simultaneous)" &&
    (!leadDetails.coOwners || leadDetails.coOwners.length === 0)
  );
}

async function createCallCollection(
  companyId,
  provider,
  callData,
  agentDetails,
  leadDetails
) {
  const baseCallData = {
    companyID: companyId,
    cuid: callData.uuid,
    callDirection: callData.direction,
    provider: provider,
    callId: callData.callId,
    callStatus: callData.callStatus,
    currentCallStatus: "Started",
    agentid: agentDetails.id,
    agentName: agentDetails.name,
    agentDesignation: agentDetails.designation,
    baseID: leadDetails !== "Lead Not Exist" ? leadDetails.baseid : null,
    clientName: leadDetails !== "Lead Not Exist" ? leadDetails.name : null,
    callAnswerStamp: callData.timestamp,
    recordingLink: tataCallingHelpers.getAppDocument(
      "",
      "",
      "",
      "",
      "",
      "",
      ""
    ),
    isSmsSent: "false",
    callNotes: "Not Available",
  };

  if (callData.direction === "outbound") {
    return new CreateCallCollection({
      ...baseCallData,
      outgoingAgentMobileNumber: callData.answeredAgentNo,
      outgoingCallerMobileNumber: callData.callerNumber,
      outgoingCallDid: callData.callToNumber,
      callStartStamp: callData.timestamp,
      leadStatusType:
        leadDetails !== "Lead Not Exist" ? leadDetails.leadStatusType : null,
      routing: "No Routing",
    });
  }

  const destinationDetails = await tataCallingHelpers.fetchDestinationID(
    companyId,
    callData.callToNumber
  );
  return new CreateCallCollection({
    ...baseCallData,
    incomingAgentMobileNumber: callData.answeredAgentNo,
    incomingCallerMobileNumber: callData.callerNumber,
    incomingCallDid: callData.callToNumber,
    destinationID: destinationDetails.destinationID,
    destinationName: destinationDetails.destinationName,
    isNewLeadCall: "false",
    leadStatusType: "Fresh",
  });
}

async function handleCallLogs(direction, callCollection) {
  if (direction === "outbound") {
    await callLogsHelper.addCallLogsToDb(callCollection);
  } else {
    await callLogsHelper.updateCallLogsToDb(
      callCollection,
      "callAnsweredByAgent"
    );
  }
}

async function addChatroomMessage(
  leadDetails,
  companyId,
  direction,
  agentName
) {
  if (leadDetails !== "Lead Not Exist") {
    const messageType = direction === "outbound" ? "Outgoing" : "Incoming";
    // await ChatroomService.addMessageToChatRoom(
    //   leadDetails.baseid,
    //   companyId,
    //   `${messageType} Call Answered By Agent: ${agentName.toUpperCase()}`
    // );
  }
}

module.exports = {
  callAnsweredByAgent,
  processCallData,
  handleInboundCall,
  createCallCollection,
  handleCallLogs,
  addChatroomMessage,
};
