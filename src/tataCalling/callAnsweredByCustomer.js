const moment = require("moment-timezone");

const employeeHelper = require("../Helpers/EmployeeHelper");
const leadHelper = require("../Helpers/LeadHelper");
const callLogsHelper = require("../Helpers/CallLogHelper");
const companyHelper = require("../Helpers/CompanyHelper");
const tataCallingHelpers = require("../tataCalling/tataCallingHelpers/TataCallingHelpers");
const callHandler = require("../tataCalling/tataCallingHelpers/CallHandler");
const { CreateCallCollection } = require("./models/callCollection");
// const ChatroomService = require("../Services/ChatroomService");

async function callAnsweredByCustomer(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Error: Only POST requests are allowed");
  }

  try {
    console.log(
      "Call answered by customer webhook payload:",
      JSON.stringify(req.body)
    );

    const callData = await processCallData(req.body);

    // Get company details
    const { companyId, provider } = await companyHelper.getCompanyIdAndProvider(
      callData.callerId.slice(-12)
    );

    // Get lead details
    const leadDetails = await leadHelper.checkLeadExist(
      companyId,
      callData.callerNumber
    );

    // Add chatroom message if lead exists
    if (leadDetails !== "Lead Not Exist") {
      //   await ChatroomService.addMessageToChatRoom(
      //     leadDetails.baseid,
      //     companyId,
      //     `Outgoing Call Answered By Customer: ${leadDetails.name.toUpperCase()}`
      //   );
    }

    // Create call collection
    const callCollection = new CreateCallCollection({
      companyID: companyId,
      cuid: callData.uuid,
      callDirection: callData.direction,
      callId: callData.callId,
      callStatus: callData.callStatus,
      callAnswerStamp: callData.answerStamp,
      provider: provider,
      baseID: leadDetails !== "Lead Not Exist" ? leadDetails.baseid : null,
      clientName: leadDetails !== "Lead Not Exist" ? leadDetails.name : null,
      currentCallStatus: "Started",
      ...(callData.direction === "outbound"
        ? {
            outgoingCallDid: callData.callToNumber,
            outgoingCallerMobileNumber: callData.callerNumber,
            callStartStamp: callData.startStamp,
            isSmsSent: "false",
            callNotes: "Not Available",
            routing: "No Routing",
          }
        : {
            incomingCallDid: callData.callToNumber,
            incomingCallerMobileNumber: callData.callerNumber,
            isNewLeadCall: "false",
            leadStatusType: "Fresh",
          }),
    });

    // Update call logs
    await callLogsHelper.updateCallLogsToDb(
      callCollection,
      "callAnsweredByCustomer"
    );

    res
      .status(200)
      .send("Call answered by customer data updated successfully.");
  } catch (error) {
    console.error("Error in callAnsweredByCustomer:", error);
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
    call_status,
  } = body;

  // Format numbers using CallHandler
  let callToNumber = callHandler.formatIndianNumberWithoutPlus(call_to_number);
  let callerNumber = callHandler.formatIndianNumberWithPlus(call_to_number);
  let callDirection = direction;
  let callerId = caller_id_number;

  // Handle click to call
  if (direction === "click_to_call") {
    callDirection = "outbound";
    callToNumber = caller_id_number;
  } else {
    callDirection = "inbound";
  }

  return {
    uuid: uuid.toString(),
    callToNumber,
    direction: callDirection,
    callId: tataCallingHelpers.convertCallId(call_id),
    callerNumber,
    callerId,
    callStatus: call_status,
    answerStamp: moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DDTHH:mm:ss.000[Z]"),
    startStamp: moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DDTHH:mm:ss.000[Z]"),
  };
}

module.exports = {
  callAnsweredByCustomer,
  processCallData,
};
