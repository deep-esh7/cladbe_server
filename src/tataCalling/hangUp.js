const CreateCallCollection = require("../tataCalling/models/callCollection");
const TriggerCallNotifications = require("../NotificationService/triggerCallNotifications");

// const ChatroomService = require("../Services/ChatroomService"); // Update path as needed
const Config = require("../../src/config");
const moment = require("moment-timezone");

// Initialize instances
const notifier = new TriggerCallNotifications();
const companyHelper = require("../Helpers/CompanyHelper");
const employeeHelper = require("../Helpers/EmployeeHelper");
const tataCallingHelpers = require("../../src/tataCalling/tataCallingHelpers/TataCallingHelpers");
const leadHelper = require("../Helpers/LeadHelper");
const callLogsHelper = require("../Helpers/CallLogHelper");

exports.hangUp = async (req, res) => {
  try {
    console.log(Config.EnvKeys.tataCalls);
    if (req.method === "POST") {
      console.log(JSON.stringify(req.body));

      const uuid = req.body.uuid.toString();
      var callToNumber = req.body.call_to_number.toString();

      // Convert timestamps to ISO format while maintaining Indian timezone
      const startStamp = moment()
        .tz("Asia/Kolkata")
        .format("YYYY-MM-DDTHH:mm:ss.000[Z]");
      const answerStamp = moment()
        .tz("Asia/Kolkata")
        .format("YYYY-MM-DDTHH:mm:ss.000[Z]");
      const callEndStamp = moment()
        .tz("Asia/Kolkata")
        .format("YYYY-MM-DDTHH:mm:ss.000[Z]");

      var agentDID;

      const hangUpCause = req.body.hangup_cause.toString();
      var callDirection = req.body.direction.toString();

      const duration = req.body.duration.toString();
      var answeredAgentNo = req.body.answered_agent_number.toString();

      const recordingLink = req.body.recording_url.toString();

      const callStatus = req.body.call_status.toString();

      // Handling Indian phone numbers
      if (callToNumber.length > 10) {
        const last10Digits = callToNumber.slice(-10);
        callToNumber = "91" + last10Digits;
      } else if (callToNumber.length === 10) {
        callToNumber = "91" + callToNumber;
      }

      const callID = tataCallingHelpers.convertCallId(
        req.body.call_id.toString()
      );
      var callerNumber = req.body["customer_no_with_prefix "].toString();

      // Handling Indian caller numbers
      if (callerNumber.length > 10) {
        const last10Digits = callerNumber.slice(-10);
        callerNumber = "+91" + last10Digits;
      } else if (callerNumber.length === 10) {
        callerNumber = "+91" + callerNumber;
      }

      console.log(
        "call status given by tata on hangup : " +
          req.body.call_status.toString()
      );

      if (callStatus == "missed" && callDirection != "clicktocall") {
        // First check if missed_agent exists and is an array with at least one element
        if (
          req.body.missed_agent &&
          Array.isArray(req.body.missed_agent) &&
          req.body.missed_agent.length > 0 &&
          req.body.missed_agent[0].number
        ) {
          const agentNumber = req.body.missed_agent[0].number.toString();

          if (agentNumber.length === 1) {
            answeredAgentNo = "+91" + agentNumber.substring(1);
          } else if (agentNumber.length === 13) {
            answeredAgentNo = "+91" + agentNumber.substring(3);
          }
        } else {
          answeredAgentNo = "";
        }
      } else {
        if (answeredAgentNo.toString().length > 10) {
          const last10Digits = answeredAgentNo.slice(-10);
          answeredAgentNo = "+91" + last10Digits;
        } else if (answeredAgentNo.length === 10) {
          answeredAgentNo = "+91" + answeredAgentNo;
        }
      }

      // Adjust callToNumber for clicktocall direction
      if (callDirection === "clicktocall") {
        callDirection = "outbound";
        callToNumber = "91" + req.body.caller_id_number.toString();
        if (callToNumber.toString().length == 10) {
          callToNumber = "91" + req.body.caller_id_number.toString();
        } else if (callToNumber.toString().length > 10) {
          const last10Digits = callToNumber.slice(-10);
          callToNumber = "91" + last10Digits;
        } else {
          callDirection = "inbound";
        }
      }

      console.log(answeredAgentNo);

      // Fetch companyId and provider using CompanyHelper
      const { companyId, provider } =
        await companyHelper.getCompanyIdAndProvider(callToNumber);

      const callData = new CreateCallCollection({
        companyID: companyId,
        callDirection: callDirection,
        callId: callID,
        callStatus: callStatus,
        callStartStamp: startStamp,
        callEndStamp: callEndStamp,
        currentCallStatus: "Ended",
        hangUpCause: hangUpCause,
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
      });

      const leadDetails = await leadHelper.checkLeadExist(
        companyId,
        callerNumber
      );

      console.log(leadDetails);

      if (callDirection != "outbound") {
        const employeeDetails = await employeeHelper.fetchEmployeeDataByNumber(
          companyId,
          answeredAgentNo
        );

        if (employeeDetails === "Employee Not Found") {
          console.log("Employee not found for number:", answeredAgentNo);
          res.status(404).send("Employee not found");
          return;
        }

        const agentID = employeeDetails.id;
        const agentName = employeeDetails.name;
        const agentDesignation = employeeDetails.designation;

        console.log(JSON.stringify(leadDetails));

        const leadID = leadDetails.baseid;
        const leadState = leadDetails.leadState;
        const coOwnerList = leadDetails.coOwners;

        // Fetch destinationID
        const destinationID = await tataCallingHelpers.fetchDestinationID(
          companyId,
          callToNumber
        );

        // Fetch destinationData
        const destinationData = await tataCallingHelpers.fetchConditions(
          companyId,
          destinationID["destinationName"],
          destinationID["destinationID"],
          true
        );

        if (leadDetails.ownerId == "") {
          await leadHelper.updateLeadData(
            companyId,
            agentID,
            agentName,
            agentDesignation,
            leadID
          );
        } else if (leadState == "inactive") {
          console.log("yaha phchaa 2");
          leadHelper.updateLeadState(companyId, leadID);
          leadHelper.updateLeadData(
            companyId,
            agentID,
            agentName,
            agentDesignation,
            leadID,
            false
          );
        } else if (
          leadDetails.ownerId != "" &&
          destinationData.routing == "Round Robin (Simultaneous)" &&
          (leadDetails.coOwners == "" || leadDetails.coOwners == [])
        ) {
          await leadHelper.updateLeadData(
            companyId,
            agentID,
            agentName,
            agentDesignation,
            leadID,
            false
          );
        } else if (
          leadDetails.ownerId != "" &&
          leadDetails.ownerId != agentID
        ) {
          console.log(
            leadDetails.ownerId +
              " owner id, routing : " +
              destinationData.routing +
              " coownerlist : " +
              leadDetails.coOwners
          );

          const coOwnerDetails = {
            id: agentID,
            designation: agentDesignation,
            name: agentName,
          };

          console.log("yaha phchaa 1 aur lead state hai " + coOwnerList);

          if (coOwnerList.some((coOwner) => coOwner.id === agentID) == false) {
            leadHelper.addOwnerAndCoOwner(coOwnerDetails, companyId, leadID);
          }
        }

        /* 
       // Commented Chatroom Service code
       await ChatroomService.addMessageToChatRoom(
         leadDetails.baseid,
         companyId,
         "Incoming Call Ended"
       );
       */

        // Send notification to first agent using new notifier
        await notifier.triggerNotification(
          {
            notificationType: "inboundCall",
            triggerType: "hangUp",
            projectName: "projectName",
            clientName: leadDetails.name,
            clientNumber: leadDetails.mobileNo,
            leadStatus: leadDetails.leadStatus,
            leadSubStatus: leadDetails.leadSubStatus,
            companyId: companyId,
            baseId: leadDetails.baseid,
          },
          companyId,
          leadDetails.ownerId
        );

        await callLogsHelper.updateCallLogsToDb(
          callData,
          "hangUp",
          recordingLink
        );
      } else {
        // Send notification for hangup to outbound call using new notifier
        await notifier.triggerNotification(
          {
            notificationType: "outboundCall",
            triggerType: "hangUp",
            projectName: "projectName",
            clientName: leadDetails.name,
            clientNumber: leadDetails.mobileNo,
            leadStatus: leadDetails.leadStatus,
            leadSubStatus: leadDetails.leadSubStatus,
            companyId: companyId,
            baseId: leadDetails.baseid,
          },
          companyId,
          leadDetails.ownerId
        );

        await updateCallLogsToDb(callData, "hangUp", recordingLink);

        /* 
       // Commented Chatroom Service code
       await ChatroomService.addMessageToChatRoom(
         leadDetails.baseid,
         companyId,
         "Outgoing Call Ended"
       );
       */
      }

      res.status(200).send("Call logs updated successfully.");
    } else {
      res
        .status(405)
        .send("Error: Only POST requests are allowed at this endpoint");
    }
  } catch (error) {
    console.error("Error in hangUp function:", error);
    res.status(500).send("Internal server error");
  }
};
