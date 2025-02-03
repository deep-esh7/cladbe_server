const db = require("../../admin").firestore();
const employeeHelper = require("../../Helpers/EmployeeHelper");

class TataCallingHelpers {
  constructor() {
    if (!TataCallingHelpers.instance) {
      TataCallingHelpers.instance = this;
    }
    return TataCallingHelpers.instance;
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

        // Handle routing updates
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
}

// Create and export singleton instance
const tataCallingHelpers = new TataCallingHelpers();
module.exports = tataCallingHelpers;
