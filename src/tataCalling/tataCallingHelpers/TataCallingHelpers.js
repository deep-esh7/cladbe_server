const db = require("../../admin").firestore();
const employeeHelper = require("../../Helpers/EmployeeHelper");
const {
  CreateCallCollection,
} = require("../../tataCalling/models/callCollection");
const axios = require("axios");
const Config = require("../../config");
const leadHelper = require("../../Helpers/LeadHelper");
const callLogsHelper = require("../../Helpers/CallLogHelper");

class TataCallingHelpers {
  constructor() {
    if (!TataCallingHelpers.instance) {
      TataCallingHelpers.instance = this;
    }
    return TataCallingHelpers.instance;
  }

  async createLead(callerNumber, companyId, conditionDetails) {
    return await leadHelper.createLead(
      callerNumber,
      companyId,
      conditionDetails
    );
  }

  convertCallId(callId) {
    try {
      if (!callId) {
        console.error("Call ID is missing");
        return "";
      }
      console.log(`Converting call ID: ${callId}`);
      const convertedId = callId.replaceAll(".", "_");
      console.log(`Converted call ID: ${convertedId}`);
      return convertedId;
    } catch (error) {
      console.error("Error converting call ID:", error);
      return callId;
    }
  }

  getAppDocument(
    name,
    documentPath,
    hashingCode,
    bucketName,
    bucketProvider,
    previewDocumentPath,
    previewHashingCode
  ) {
    try {
      const document = {
        name: name || "",
        documentPath: documentPath || "",
        bucketName: bucketName || "",
        bucketProvider: bucketProvider || "",
        hashingCode: hashingCode || "",
        previewHashingCode: previewHashingCode || "",
        previewDocumentPath: previewDocumentPath || "",
      };

      console.log("Created app document:", document);
      return document;
    } catch (error) {
      console.error("Error creating app document:", error);
      return {
        name: "",
        documentPath: "",
        bucketName: "",
        bucketProvider: "",
        hashingCode: "",
        previewHashingCode: "",
        previewDocumentPath: "",
      };
    }
  }

  async fetchDestinationID(companyID, callToNumber) {
    try {
      console.log(
        `Fetching destination ID for company ${companyID} and number ${callToNumber}`
      );

      const doc = await db
        .collection("Companies")
        .doc(companyID)
        .collection("conversations")
        .doc("telephony")
        .collection("telephony")
        .doc(callToNumber)
        .get();

      if (!doc.exists) {
        console.log(`No destination found for number ${callToNumber}`);
        throw new Error("Destination not found");
      }

      const data = doc.data();
      const result = {
        destinationName: data.destination,
        destinationID: data.destinationID,
      };

      console.log("Found destination:", result);
      return result;
    } catch (error) {
      console.error("Error fetching destination ID:", {
        error: error.message,
        companyID,
        callToNumber,
      });
      throw error;
    }
  }

  async fetchConditions(companyId, destination, destinationID, fullDetails) {
    try {
      let employeeList = [];
      let accessGroupList = [];
      let projectList = [];
      let employeeNumbersList = [];

      console.log(
        `Fetching conditions for ${destination} with ID ${destinationID}`
      );

      if (destination === "Employee") {
        return await employeeHelper.fetchEmployeeData(
          companyId,
          destinationID,
          fullDetails
        );
      } else if (destination === "Conditions") {
        console.log("Processing conditions for ID:", destinationID);

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

        if (!doc.exists) {
          console.log("Condition document does not exist");
          return null;
        }

        const data = doc.data();

        if (data.conditionStatus !== "isActive") {
          console.log("Condition is not active");
          return null;
        }

        if (fullDetails === true) {
          return data;
        }

        projectList = data.projectBlockList || [];
        accessGroupList = data.accessGroupList || [];

        if (data.employeeList) {
          employeeList = data.employeeList;
          employeeNumbersList = await Promise.all(
            employeeList.map(async (item) => ({
              data: await employeeHelper.fetchEmployeeData(
                companyId,
                item.id,
                true
              ),
            }))
          );
        }

        if (
          data.routing === "Round Robin (1 by 1)" ||
          data.routing === "Round Robin (Simultaneous)"
        ) {
          await employeeHelper.updateEmployeeListToDB(
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
          routing: data.routing || "",
          stickyAgent: data.stickyAgent || false,
          inActiveCallAsNewLead: data.inActiveLeadAsNewLead || false,
          callTransferToCoOwner: data.callTransferToCoOwner || false,
          subsource: data.subSource || "",
          source: data.source || "",
          subStatus: data.subStatus || "",
          status: data.status || "",
          projects: data.projects || [],
          fromThisTeamOnly: data.fromThisTeamOnly || false,
        };
      }

      return null;
    } catch (error) {
      console.error("Error fetching conditions:", {
        error: error.message,
        stack: error.stack,
        companyId,
        destination,
        destinationID,
      });
      return null;
    }
  }

  async handleExistingLead(
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

      await callLogsHelper.updateCallLogsToDb(callData);
      const callHandler = require("./CallHandler");

      if (leadData.ownerName === "") {
        await callHandler.routeCall(
          companyId,
          {callToNumber, callerNumber, callId: callID},
          leadData.baseid,
          res
        );
      } else if (leadData.ownerName !== "") {
        const conditionDetails = await this.fetchConditions(
          companyId,
          destinationDetails.destinationName,
          destinationDetails.destinationID,
          true
        );

        if (conditionDetails.stickyAgent) {
          if (conditionDetails.fromThisTeamOnly) {
            await callHandler.handleTeamRouting(
              companyId,
              employeeData,
              leadData,
              conditionDetails,
              res
            );
          } else {
            await callHandler.routeSingleCall(
              companyId,
              res,
              conditionDetails,
              employeeData,
              leadData
            );
          }
        } else {
          await callHandler.routeCall(
            companyId,
            {callToNumber, callerNumber, callId: callID},
            leadData.baseid,
            res
          );
        }
      }
    } catch (error) {
      console.error("Error in handleExistingLead:", error);
      throw error;
    }
  }

  async handleNewOrInactiveLead(
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
      } else {
        const conditionDetails = await this.fetchConditions(
          companyId,
          destinationDetails.destinationName,
          destinationDetails.destinationID,
          true
        );

        const leadDetails = await leadHelper.createLead(
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

      await callLogsHelper.updateCallLogsToDb(callData);
      const callHandler = require("./CallHandler");
      
      await callHandler.routeCall(
        companyId,
        {callToNumber, callerNumber, callId: callID},
        baseId,
        res
      );
    } catch (error) {
      console.error("Error in handleNewOrInactiveLead:", error);
      throw error;
    }
  }

  async fetchDestinationBycallToNumber(
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

      if (!doc.exists || !doc.data().isActive) {
        return null;
      }

      const data = doc.data();
      const destination = data.destination;
      const destinationID = data.destinationID;

      if (destination === "Conditions") {
        const conditionDetails = await this.fetchConditions(
          companyId,
          destination,
          destinationID,
          false
        );

        const employeeDetails = conditionDetails.phoneNumbers;
        const employeeDataMap = new Map();
        const employeeMobileNumberList = [];
        let firstEmployeeDetails = null;

        employeeDetails.forEach((employee) => {
          if (!firstEmployeeDetails) {
            firstEmployeeDetails = {
              name: employee.data.name,
              designation: employee.data.designation,
              id: employee.data.id,
              phoneNumber: employee.data.phoneNumber,
            };
          }

          employeeDataMap.set(employee.data.phoneNumber, [
            employee.data.name,
            employee.data.id,
            employee.data.designation,
          ]);

          employeeMobileNumberList.push(employee.data.phoneNumber);
        });

        const callLogs = new CreateCallCollection({
          companyID: companyId,
          agentid: firstEmployeeDetails?.id,
          agentName: firstEmployeeDetails?.name,
          agentDesignation: firstEmployeeDetails?.designation,
          incomingAgentMobileNumber: firstEmployeeDetails?.phoneNumber,
          destinationID: destinationID,
          baseID: leadID,
          callId: callID,
          agentIDs: employeeMobileNumberList,
          leadStatusType: "Fresh",
          stickyAgent: conditionDetails.stickyAgent,
        });

        const leadData = await leadHelper.checkLeadExist(
          companyId,
          callerNumber
        );

        await this.handleCallAssignments(
          companyId,
          employeeDataMap,
          employeeMobileNumberList,
          callID,
          leadID,
          conditionDetails,
          callLogs,
          leadData
        );

        const welcomeRecording = await this.getRecordingId(
          companyId,
          conditionDetails.welcomeRecordingId
        );
        const onHoldRecording = await this.getRecordingId(
          companyId,
          conditionDetails.onHoldRecordingId
        );

        return {
          type: "numbers",
          welcomeRecordingId: welcomeRecording,
          onHoldRecordingId: onHoldRecording,
          hangUpRecordingId: conditionDetails.hangUpRecordingId,
          data: employeeMobileNumberList,
          routing: conditionDetails.routing,
        };
      } else if (destination === "Employee") {
        const employeeDetails = await this.fetchConditions(
          companyId,
          destination,
          destinationID,
          true
        );

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

        await callLogsHelper.updateCallLogsToDb(callLogs, "fetchAgentData");

        return {
          type: "numbers",
          data: employeeDetails.phoneNumber,
          welcomeRecordingId: "",
          onHoldRecordingId: "146393",
          hangUpRecordingId: "",
        };
      }

      return null;
    } catch (error) {
      console.error("Error in fetchDestinationBycallToNumber:", error);
      throw error;
    }
  }

  async handleCallAssignments(
    companyId,
    employeeDataMap,
    employeeMobileNumberList,
    callId,
    leadId,
    conditions,
    callLogs,
    leadData
  ) {
    try {
      await callLogsHelper.updateCallLogsToDb(callLogs, "fetchAgentData");

      await this.hitLiveCallCheckApi(
        companyId,
        employeeDataMap,
        employeeMobileNumberList,
        callId,
        leadId,
        conditions.stickyAgent,
        conditions.inActiveCallAsNewLead && leadData?.leadState === "inactive"
      );
    } catch (error) {
      console.error("Error in handleCallAssignments:", error);
      throw error;
    }
  }

  constructNumbersResponse(destinationDetails) {
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

  async getRecordingId(companyId, recordingId) {
    if (!recordingId || recordingId.trim() === "") {
      return "";
    }

    try {
      return await this.fetchTataRecordingIdByRecordingIdDoc(
        companyId,
        recordingId
      );
    } catch (error) {
      console.error("Error getting recording ID:", error);
      return "";
    }
  }

  async handleCallAssignment(
    firstCall,
    employeeDataMap,
    companyId,
    callId,
    leadId,
    stickyAgent,
    deleteCoOwners
  ) {
    const employeeDetails = employeeDataMap.get(firstCall.destination);
    if (!employeeDetails) {
      console.log(
        `Employee details not found for destination: ${firstCall.destination}`
      );
      return;
    }

    const [agentName, agentId, agentDesignation] = employeeDetails;

    const callLogs = new CreateCallCollection({
      companyID: companyId,
      callId: callId,
      agentid: agentId,
      agentName: agentName,
      agentDesignation: agentDesignation,
      incomingAgentMobileNumber: firstCall.destination,
      leadStatusType: "Fresh",
    });

    await leadHelper.updateLeadData(
      companyId,
      agentId,
      agentName,
      agentDesignation,
      leadId,
      stickyAgent,
      deleteCoOwners
    );

    await callLogsHelper.updateCallLogsToDb(callLogs, "fetchAgentData");
  }

  async hitLiveCallCheckApi(
    companyId,
    employeeDataMap,
    employeeMobileNumberList,
    callId,
    leadId,
    stickyAgent,
    deleteCoOwners
  ) {
    try {
      const apiUrl = `https://api-smartflo.tatateleservices.com/v1/live_calls?call_id=${callId}`;
      const token = "Bearer " + Config.EnvKeys.tataCalls;
      let taskCompleted = "no";

      const makeApiCall = async () => {
        try {
          const response = await axios.get(apiUrl, {
            headers: {
              "Content-Type": "application/json",
              Authorization: token,
            },
          });

          const data = response.data;

          if (!data?.length || taskCompleted === "yes") {
            return;
          }

          const firstCall = data[0];
          if (
            firstCall?.destination &&
            firstCall.destination !== employeeMobileNumberList[0]
          ) {
            await this.handleCallAssignment(
              firstCall,
              employeeDataMap,
              companyId,
              callId,
              leadId,
              stickyAgent,
              deleteCoOwners
            );
          }

          setTimeout(makeApiCall, 5000);
        } catch (error) {
          console.error("Error in live call check:", error);
        }
      };

      await makeApiCall();
    } catch (error) {
      console.error("Error in hitLiveCallCheckApi:", error);
    }
  }

  async fetchTataRecordingIdByRecordingIdDoc(companyId, audioFileId) {
    try {
      const doc = await db
        .collection("Companies")
        .doc(companyId)
        .collection("conversations")
        .doc("telephony")
        .collection("audioFiles")
        .doc(audioFileId)
        .get();

      if (!doc.exists) {
        throw new Error(`Audio file with ID ${audioFileId} not found`);
      }

      return doc.data().recordingIdForTata;
    } catch (error) {
      console.error("Error fetching Tata recording ID:", error);
      throw error;
    }
  }

  cleanObject(obj) {
    return Object.fromEntries(
      Object.entries(obj).filter(([_, v]) => v !== undefined)
    );
  }
}

// Create and export singleton instance
const tataCallingHelpers = new TataCallingHelpers();
module.exports = tataCallingHelpers;