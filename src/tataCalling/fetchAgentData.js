const moment = require("moment-timezone");
const {
  CreateCallCollection,
} = require("../tataCalling/models/callCollection");
const companyHelper = require("../Helpers/CompanyHelper");
const employeeHelper = require("../Helpers/EmployeeHelper");
const leadHelper = require("../Helpers/LeadHelper");
const callLogsHelper = require("../Helpers/CallLogHelper");
const tataCallingHelpers = require("../tataCalling/tataCallingHelpers/TataCallingHelpers");
const callHandler = require("../tataCalling/tataCallingHelpers/CallHandler");

class FetchAgentHandler {
  constructor() {
    if (!FetchAgentHandler.instance) {
      FetchAgentHandler.instance = this;
    }
    return FetchAgentHandler.instance;
  }

  async fetchAgentData(req, res) {
    try {
      console.log("Received request:", {
        body: req.body,
        method: req.method,
        url: req.url,
      });

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

      // Format phone numbers using CallHandler's method
      // In FetchAgentHandler class
      let callToNumber = callHandler.formatIndianNumberWithoutPlus(
        req.body.call_to_number
      );
      let callerNumber = callHandler.formatIndianNumberWithPlus(
        req.body.caller_id_number
      );
      // Convert timestamps
      const startStamp = moment(req.body.start_stamp)
        .tz("Asia/Kolkata")
        .format("YYYY-MM-DDTHH:mm:ss.000[Z]");

      // Get company and provider using existing helper
      const { companyId, provider } =
        await companyHelper.getCompanyIdAndProvider(callToNumber);

      // Get destination details using existing helper
      const destinationDetails = await tataCallingHelpers.fetchDestinationID(
        companyId,
        callToNumber
      );

      // Check lead existence using existing helper
      const leadData = await leadHelper.checkLeadExist(companyId, callerNumber);

      // Create call data object
      const callData = {
        callToNumber,
        callerNumber,
        startStamp,
        callId: tataCallingHelpers.convertCallId(req.body.call_id),
      };

      if (leadData !== "Lead Not Exist" && leadData.leadState !== "inactive") {
        await this.handleExistingLead(
          leadData,
          companyId,
          destinationDetails,
          provider,
          callData,
          res
        );
      } else {
        await this.handleNewLead(
          leadData,
          companyId,
          destinationDetails,
          provider,
          callData,
          res
        );
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
  }

  async handleExistingLead(
    leadData,
    companyId,
    destinationDetails,
    provider,
    callData,
    res
  ) {
    try {
      // Get employee data
      const employeeData = await employeeHelper.fetchEmployeeData(
        companyId,
        leadData.ownerId || "",
        false
      );

      // Create call log entry
      const callLogData = new CreateCallCollection({
        companyID: companyId,
        callDirection: "inbound",
        destinationID: destinationDetails.destinationID,
        destinationName: destinationDetails.destinationName,
        provider: provider,
        incomingAgentMobileNumber: employeeData,
        agentName: leadData.ownerName,
        agentDesignation: leadData.designation,
        agentid: leadData.ownerId,
        callId: callData.callId,
        baseID: leadData.baseid,
        incomingCallDid: callData.callToNumber,
        callStartStamp: callData.startStamp,
        leadStatusType: "Fresh",
        currentCallStatus: "Started",
        incomingCallerMobileNumber: callData.callerNumber,
        isSmsSent: "false",
        callNotes: "Not Available",
        clientName: leadData.name,
        routing: "No Routing",
      });

      // Update call logs using SQL helper
      await callLogsHelper.addCallLogsToDb(callLogData);

      if (!leadData.ownerName) {
        // Use CallHandler's routeCall method
        await callHandler.routeCall(companyId, callData, leadData.baseid, res);
      } else {
        const conditions = await tataCallingHelpers.fetchConditions(
          companyId,
          destinationDetails.destinationName,
          destinationDetails.destinationID,
          true
        );

        if (conditions.stickyAgent) {
          if (conditions.fromThisTeamOnly) {
            await callHandler.handleTeamRouting(
              companyId,
              employeeData,
              leadData,
              conditions,
              res
            );
          } else {
            await callHandler.routeSingleCall(
              companyId,
              res,
              conditions,
              employeeData,
              leadData
            );
          }
        } else {
          await callHandler.routeCall(
            companyId,
            callData,
            leadData.baseid,
            res
          );
        }
      }
    } catch (error) {
      console.error("Error handling existing lead:", error);
      throw error;
    }
  }

  async handleNewLead(
    leadData,
    companyId,
    destinationDetails,
    provider,
    callData,
    res
  ) {
    try {
      const conditions = await tataCallingHelpers.fetchConditions(
        companyId,
        destinationDetails.destinationName,
        destinationDetails.destinationID,
        true
      );

      // Create or reactivate lead
      const newLeadData =
        leadData.leadState === "inactive"
          ? leadData
          : await leadHelper.createLead(
              callData.callerNumber,
              companyId,
              conditions
            );

      // Create call log entry
      const callLogData = new CreateCallCollection({
        companyID: companyId,
        callDirection: "inbound",
        destinationID: destinationDetails.destinationID,
        destinationName: destinationDetails.destinationName,
        provider: provider,
        callId: callData.callId,
        baseID: newLeadData.baseid || newLeadData.leadId,
        incomingCallerMobileNumber: callData.callerNumber,
        incomingCallDid: callData.callToNumber,
        callStartStamp: callData.startStamp,
        leadStatusType:
          leadData.leadState === "inactive" ? "Interested" : "Unallocated",
        currentCallStatus: "Started",
        isSmsSent: "false",
        callNotes: "Not Available",
        clientName: newLeadData.name || newLeadData.clientName,
        routing: "No Routing",
      });

      // Update call logs using SQL helper
      await callLogsHelper.updateCallLogsToDb(callLogData);

      // Use CallHandler's routeCall method
      await callHandler.routeCall(
        companyId,
        callData,
        newLeadData.baseid || newLeadData.leadId,
        res
      );
    } catch (error) {
      console.error("Error handling new lead:", error);
      throw error;
    }
  }
}

// Create and export singleton instance
const fetchAgentHandler = new FetchAgentHandler();
module.exports = fetchAgentHandler;
