const moment = require("moment-timezone");
const { CreateCallCollection } = require("../models/callCollection");
const companyHelper = require("../../Helpers/CompanyHelper");
const employeeHelper = require("../../Helpers/EmployeeHelper");
const leadHelper = require("../../Helpers/LeadHelper");
const uploadCallRecording = require("../tataCallingHelpers/UploadCallRecording");

class CallHandler {
  constructor() {
    if (!CallHandler.instance) {
      CallHandler.instance = this;
    }
    return CallHandler.instance;
  }

  formatIndianNumberWithoutPlus(number) {
    if (!number) return "";

    const digits = number.toString();

    if (digits.length > 10) {
      return "91" + digits.slice(-10);
    } else if (digits.length === 10) {
      return "91" + digits;
    }

    return digits;
  }

  formatIndianNumberWithPlus(number) {
    if (!number) return "";

    const digits = number.toString();

    if (digits.length > 10) {
      return "+91" + digits.slice(-10);
    } else if (digits.length === 10) {
      return "+91" + digits;
    }

    return digits;
  }

  async handleTeamRouting(companyId, employeeData, leadData, conditions, res) {
    try {
      const employeeList = conditions.employeeList;

      if (employeeList.some((employee) => employee.id === leadData.ownerId)) {
        await this.routeSingleCall(
          companyId,
          res,
          conditions,
          employeeData,
          leadData
        );
      } else if (
        conditions.callTransferToCoOwner &&
        employeeList.some((employee) => employee.id === leadData.coOwners?.id)
      ) {
        const matchingEmployee = employeeList.find(
          (employee) => employee.id === leadData.coOwners.id
        );

        if (matchingEmployee) {
          const coOwnerDetails = await employeeHelper.fetchEmployeeData(
            companyId,
            matchingEmployee.id,
            true
          );

          await this.routeSingleCall(
            companyId,
            res,
            conditions,
            coOwnerDetails.number,
            leadData
          );
        }
      } else {
        await this.routeCall(companyId, callData, leadData.baseid, res);
      }
    } catch (error) {
      console.error("Error in handleTeamRouting:", error);
      throw error;
    }
  }



  async routeSingleCall(companyId, res, conditions, employeeData, leadData) {
    try {
      const tataCallingHelpers = require("../tataCallingHelpers/TataCallingHelpers");
      const response = [];

      if (conditions.welcomeRecordingId?.trim()) {
        response.push({
          recording: {
            type: "system",
            data: await tataCallingHelpers.fetchTataRecordingIdByRecordingIdDoc(
              companyId,
              conditions.welcomeRecordingId
            ),
          },
        });
      }

      const transfer = {
        transfer: {
          type: "number",
          data: [employeeData],
        },
      };

      if (conditions.onHoldRecordingId?.trim()) {
        transfer.transfer.moh =
          await tataCallingHelpers.fetchTataRecordingIdByRecordingIdDoc(
            companyId,
            conditions.onHoldRecordingId
          );
      }

      response.push(transfer);
      res.send(response);
    } catch (error) {
      console.error("Error in routeSingleCall:", error);
      throw error;
    }
  }

  async routeCall(companyId, callData, baseId, res) {
    try {
      const tataCallingHelpers = require("../tataCallingHelpers/TataCallingHelpers");
      const destinationDetails =
        await tataCallingHelpers.fetchDestinationBycallToNumber(
          companyId,
          callData.callToNumber,
          callData.callerNumber,
          callData.callId,
          baseId
        );

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
        const response = await this.constructNumbersResponse(
          destinationDetails
        );
        return res.send(response);
      }

      res.send([]);
    } catch (error) {
      console.error("Error in routeCall:", error);
      throw error;
    }
  }

  async constructNumbersResponse(destinationDetails) {
    const dataList = destinationDetails.data.filter(
      (item) => item !== undefined
    );
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

  async handleHangUp(req, res) {
    try {
      if (req.method !== "POST") {
        return res.status(405).send("Error: Only POST requests are allowed");
      }

      const {
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
      } = req.body;

      const tataCallingHelpers = require("../tataCallingHelpers/TataCallingHelpers");

      let callToNumber = tataCallingHelpers.formatPhoneNumber(call_to_number);
      let callerNumber = tataCallingHelpers.formatPhoneNumber(
        customer_no_with_prefix
      );
      let answeredAgentNo = this.formatAgentNumber(
        answered_agent_number,
        call_status,
        direction,
        missed_agent
      );

      let callDirection = direction;
      if (direction === "clicktocall") {
        callDirection = callToNumber.length >= 10 ? "outbound" : "inbound";
      }

      const { companyId, provider } =
        await companyHelper.getCompanyIdAndProvider(callToNumber);

      const destinationID = await tataCallingHelpers.fetchDestinationID(
        companyId,
        callToNumber
      );

      const leadDetails = await leadHelper.checkLeadExist(
        companyId,
        callerNumber
      );

      const employeeDetails = await employeeHelper.fetchEmployeeDataByNumber(
        companyId,
        answeredAgentNo
      );

      const callData = new CreateCallCollection({
        companyID: companyId,
        callDirection: callDirection,
        callId: tataCallingHelpers.convertCallId(call_id),
        callStatus: call_status,
        callStartStamp: moment()
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DDTHH:mm:ss.000[Z]"),
        callEndStamp: moment()
          .tz("Asia/Kolkata")
          .format("YYYY-MM-DDTHH:mm:ss.000[Z]"),
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
        callerDid: call_to_number,
        clientNumber: callerNumber,
        incomingAgentMobileNumber: answeredAgentNo,
        agentid: employeeDetails?.id,
        agentName: employeeDetails?.name,
        agentDesignation: employeeDetails?.designation,
        baseID: leadDetails?.baseid,
        leadStatusType: leadDetails?.leadStatusType,
        destinationID: destinationID?.destinationID,
        destinationName: destinationID?.destinationName,
      });

      if (callDirection !== "outbound") {
        if (employeeDetails?.id) {
          await leadHelper.updateLeadData(
            companyId,
            employeeDetails.id,
            employeeDetails.name,
            employeeDetails.designation,
            leadDetails.baseid,
            false
          );

          await this.notifyAgent(
            {
              notificationType: "inboundCall",
              triggerType: "hangUp",
              projectName: leadDetails.projectData?.[0]?.name || "",
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
        }
      } else {
        await this.notifyAgent(
          {
            notificationType: "outboundCall",
            triggerType: "hangUp",
            projectName: leadDetails.projectData?.[0]?.name || "",
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
      }

      await tataCallingHelpers.updateCallLogsToDb(
        callData,
        "hangUp",
        recording_url
      );

      res.status(200).send("Call logs updated successfully.");
    } catch (error) {
      console.error("Error in handleHangUp:", error);
      res.status(500).send("Internal server error");
    }
  }

  formatAgentNumber(number, status, direction, missedAgents) {
    if (status === "missed" && direction !== "clicktocall") {
      if (missedAgents?.[0]?.number) {
        const agentNumber = missedAgents[0].number.toString();
        return agentNumber.length === 1
          ? "+91" + agentNumber.substring(1)
          : agentNumber.length === 13
          ? "+91" + agentNumber.substring(3)
          : "";
      }
      return "";
    }

    const digits = number?.toString() || "";
    if (digits.length > 10) {
      return "+91" + digits.slice(-10);
    }
    return digits.length === 10 ? "+91" + digits : digits;
  }

  async notifyAgent(notificationData, companyId, agentId) {
    try {
      console.log("Sending notification to agent:", notificationData);
    } catch (error) {
      console.error("Error sending notification:", error);
    }
  }
}

const callHandler = new CallHandler();
module.exports = callHandler;
