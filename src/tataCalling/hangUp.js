const moment = require("moment-timezone");
const {
  CreateCallCollection,
} = require("../tataCalling/models/callCollection");
const TriggerCallNotifications = require("../NotificationService/triggerCallNotifications");
const Config = require("../config");

// Initialize helper instances
const notifier = new TriggerCallNotifications();
const companyHelper = require("../Helpers/CompanyHelper");
const employeeHelper = require("../Helpers/EmployeeHelper");
const tataCallingHelpers = require("../tataCalling/tataCallingHelpers/TataCallingHelpers");
const leadHelper = require("../Helpers/LeadHelper");
const callLogsHelper = require("../Helpers/CallLogHelper");
const callHandler = require("./tataCallingHelpers/CallHandler");

async function hangUp(req, res) {
  try {
    console.log("Config token:", Config.EnvKeys.tataCalls);

    if (req.method !== "POST") {
      return res.status(405).send("Error: Only POST requests are allowed");
    }

    console.log("Hangup webhook payload:", JSON.stringify(req.body));

    // Extract call data
    let {
      uuid,
      call_to_number,
      hangup_cause,
      direction,
      duration,
      answered_agent_number,
      recording_url,
      call_status,
      call_id,
      customer_no_with_prefix,
      missed_agent,
      caller_id_number,
    } = req.body;

    const timestamp = moment()
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DDTHH:mm:ss.000[Z]");

    // Format phone numbers using CallHandler
    let callToNumber =
      callHandler.formatIndianNumberWithoutPlus(call_to_number);
    let callerNumber = callHandler.formatIndianNumberWithPlus(
      customer_no_with_prefix
    );
    let answeredAgentNo = callHandler.formatAgentNumber(
      answered_agent_number,
      call_status,
      direction,
      missed_agent
    );

    // Handle call direction
    let callDirection = direction;
    if (direction === "clicktocall") {
      callDirection = "outbound";
      callToNumber =
        callHandler.formatIndianNumberWithoutPlus(caller_id_number);
    }

    // Get company details
    const { companyId, provider } = await companyHelper.getCompanyIdAndProvider(
      callToNumber
    );
    console.log("Company details:", { companyId, provider });

    // Get lead details
    const leadDetails = await leadHelper.checkLeadExist(
      companyId,
      callerNumber
    );
    console.log("Lead details:", leadDetails);

    // Get destination details
    let destinationDetails = null;
    let employeeDetails = null;

    if (callDirection !== "outbound") {
      // Get destination details
      destinationDetails = await tataCallingHelpers.fetchDestinationID(
        companyId,
        callToNumber
      );
      console.log("Destination details:", destinationDetails);

      // Get employee details if agent number exists
      if (answeredAgentNo) {
        employeeDetails = await employeeHelper.fetchEmployeeDataByNumber(
          companyId,
          answeredAgentNo
        );
        console.log("Employee details:", employeeDetails);
      }

      // Get destination conditions
      if (destinationDetails) {
        const conditions = await tataCallingHelpers.fetchConditions(
          companyId,
          destinationDetails.destinationName,
          destinationDetails.destinationID,
          true
        );

        // Handle lead updates
        if (
          employeeDetails !== "Employee Not Found" &&
          leadDetails !== "Lead Not Exist"
        ) {
          await handleLeadUpdates(
            companyId,
            employeeDetails,
            leadDetails,
            conditions
          );
        }
      }
    }

    // Create call collection
    const callCollection = new CreateCallCollection({
      companyID: companyId,
      cuid: uuid,
      callDirection: callDirection,
      provider: provider,
      callId: tataCallingHelpers.convertCallId(call_id),
      callStatus: call_status,
      callStartStamp: timestamp,
      callEndStamp: timestamp,
      currentCallStatus: "Ended",
      hangUpCause: hangup_cause,
      duration: duration,
      recordingLink: tataCallingHelpers.getAppDocument(
        "",
        "",
        "",
        "",
        "",
        "",
        ""
      ),
      // callerDid: call_to_number,
      clientNumber: callerNumber,
      incomingAgentMobileNumber: answeredAgentNo,
      agentid: employeeDetails?.id,
      agentName: employeeDetails?.name,
      agentDesignation: employeeDetails?.designation,
      baseID: leadDetails?.baseid,
      leadStatusType: leadDetails?.leadStatusType,
      destinationID: destinationDetails?.destinationID,
      destinationName: destinationDetails?.destinationName,
    });

    // Send notifications
    if (leadDetails !== "Lead Not Exist") {
      await sendNotifications(callDirection, companyId, leadDetails, notifier);
    }

    // Update call logs
    await callLogsHelper.updateCallLogsToDbWithRecording(
      callCollection,
      "hangUp",
      recording_url
    );

    res.status(200).send("Call logs updated successfully.");
  } catch (error) {
    console.error("Error in hangUp function:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error",
      error: error.stack,
    });
  }
}

async function handleLeadUpdates(
  companyId,
  employeeDetails,
  leadDetails,
  conditions
) {
  // Handle unassigned lead
  if (!leadDetails.ownerId) {
    await leadHelper.updateLeadData(
      companyId,
      employeeDetails.id,
      employeeDetails.name,
      employeeDetails.designation,
      leadDetails.baseid,
      conditions?.stickyAgent || false
    );
  }
  // Handle inactive lead
  else if (leadDetails.leadState === "inactive") {
    await leadHelper.updateLeadState(companyId, leadDetails.baseid);
    await leadHelper.updateLeadData(
      companyId,
      employeeDetails.id,
      employeeDetails.name,
      employeeDetails.designation,
      leadDetails.baseid,
      false
    );
  }
  // Handle simultaneous routing
  else if (
    leadDetails.ownerId &&
    conditions?.routing === "Round Robin (Simultaneous)" &&
    (!leadDetails.coOwners || leadDetails.coOwners.length === 0)
  ) {
    await leadHelper.updateLeadData(
      companyId,
      employeeDetails.id,
      employeeDetails.name,
      employeeDetails.designation,
      leadDetails.baseid,
      false
    );
  }
  // Handle co-owner assignment
  else if (leadDetails.ownerId !== employeeDetails.id) {
    const coOwnerDetails = {
      id: employeeDetails.id,
      designation: employeeDetails.designation,
      name: employeeDetails.name,
    };

    if (
      !leadDetails.coOwners?.some(
        (coOwner) => coOwner.id === employeeDetails.id
      )
    ) {
      await leadHelper.addOwnerAndCoOwner(
        coOwnerDetails,
        companyId,
        leadDetails.baseid
      );
    }
  }
}

async function sendNotifications(
  callDirection,
  companyId,
  leadDetails,
  notifier
) {
  // First check if leadDetails exists and is not "Lead Not Exist"
  if (!leadDetails || leadDetails === "Lead Not Exist") {
    console.log("No lead details available for notification");
    return;
  }

  try {
    const notificationData = {
      notificationType:
        callDirection === "outbound" ? "outboundCall" : "inboundCall",
      triggerType: "hangUp",
      projectName:
        leadDetails.projectData && leadDetails.projectData[0]
          ? leadDetails.projectData[0].name
          : "",
      clientName: leadDetails.name || "",
      clientNumber: leadDetails.mobileNo || "",
      leadStatus: leadDetails.leadStatus || "",
      leadSubStatus: leadDetails.leadSubStatus || "",
      companyId: companyId,
      baseId: leadDetails.baseid || "",
    };

    // Only send notification if we have an ownerId
    if (leadDetails.ownerId) {
      await notifier.triggerNotification(
        notificationData,
        companyId,
        leadDetails.ownerId
      );
    } else {
      console.log("No owner ID found for notification");
    }
  } catch (error) {
    console.error("Error sending notification:", error);
    // Don't throw error to prevent call log update failure
  }
}

module.exports = {
  hangUp,
  handleLeadUpdates,
  sendNotifications,
};
