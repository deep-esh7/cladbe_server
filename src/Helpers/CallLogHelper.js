const db = require("../../src/db/connection");
const TableNames = require("./TableNames");

class CallLogsHelper {
  constructor() {
    if (!CallLogsHelper.instance) {
      CallLogsHelper.instance = this;
      this.tataCallingHelpers = require("../tataCalling/tataCallingHelpers/TataCallingHelpers");
      this.uploadCallRecording = require("../tataCalling/tataCallingHelpers/UploadCallRecording");
    }
    return CallLogsHelper.instance;
  }

  cleanObject(obj) {
    try {
      return Object.fromEntries(
        Object.entries(obj).filter(([_, value]) => value !== undefined)
      );
    } catch (error) {
      console.error("Error cleaning object:", error);
      return obj;
    }
  }

  async addCallLogsToDb(callLogs) {
    try {
      // Define default values for all columns
      const defaultValues = {
        companyID: callLogs.companyID || null,
        cuid: callLogs.cuid || null,
        callerDid: callLogs.callerDid || null,
        clientNumber: callLogs.clientNumber || null,
        incomingCallDid: callLogs.incomingCallDid || null,
        outgoingCallDid: callLogs.outgoingCallDid || null,
        callStartStamp: callLogs.callStartStamp || null,
        recordingLink: callLogs.recordingLink || null,
        agentid: callLogs.agentid || null,
        callStatus: callLogs.callStatus || null,
        callTranfer: callLogs.callTranfer || false,
        callTransferIds: callLogs.callTransferIds || [],
        department: callLogs.department || null,
        projects: callLogs.projects || null,
        accessGroups: callLogs.accessGroups || [],
        destinationID: callLogs.destinationID || null,
        destinationName: callLogs.destinationName || null,
        welcomeRecordingID: callLogs.welcomeRecordingID || null,
        onHoldRecordingID: callLogs.onHoldRecordingID || null,
        hangUpRecordingID: callLogs.hangUpRecordingID || null,
        isNewLeadCall: callLogs.isNewLeadCall || false,
        baseID: callLogs.baseID || null,
        isSmsSent: callLogs.isSmsSent || false,
        callDateTime: callLogs.callDateTime || callLogs.callStartStamp || null,
        advertisedNumber: callLogs.advertisedNumber || null,
        callDirection: callLogs.callDirection || null,
        endStamp: callLogs.endStamp || null,
        duration: callLogs.duration || 0,
        source: callLogs.source || null,
        subsource: callLogs.subsource || null,
        stickyAgent: callLogs.stickyAgent || false,
        fromThisTeamOnly: callLogs.fromThisTeamOnly || false,
        ivrName: callLogs.ivrName || null,
        ivrId: callLogs.ivrId || null,
        incomingCallerMobileNumber: callLogs.incomingCallerMobileNumber || null,
        outgoingCallerMobileNumber: callLogs.outgoingCallerMobileNumber || null,
        incomingAgentMobileNumber: callLogs.incomingAgentMobileNumber || null,
        outgoingAgentMobileNumber: callLogs.outgoingAgentMobileNumber || null,
        agentName: callLogs.agentName || null,
        agentDesignation: callLogs.agentDesignation || null,
        callEndStamp: callLogs.callEndStamp || null,
        callAnswerStamp: callLogs.callAnswerStamp || null,
        hangUpCause: callLogs.hangUpCause || null,
        leadAssigned: callLogs.leadAssigned || false,
        currentCallStatus: callLogs.currentCallStatus || "defaultValue",
        clientName: callLogs.clientName || null,
        callId: callLogs.callId,
        provider: callLogs.provider || null,
        routing: callLogs.routing || null,
        afterCallSmsID: callLogs.afterCallSmsID || null,
        leadStatusType: callLogs.leadStatusType || null,
        callNotes: callLogs.callNotes || null,
        agentIDs: callLogs.agentIDs || [],
      };

      const columns = Object.keys(defaultValues);
      const values = Object.values(defaultValues);
      const placeholders = values.map((_, index) => `$${index + 1}`);

      const query = `
        INSERT INTO ${TableNames.CALL_COLLECTION} (${columns
        .map((col) => (typeof col === "string" ? `"${col}"` : col))
        .join(", ")})
        VALUES (${placeholders.join(", ")})
        RETURNING *;
      `;

      console.log("Insert Query:", { query, values });
      const result = await db.query(query, values);
      console.log("Insert Result:", result.rows[0]);
      return result;
    } catch (error) {
      console.error("Error in addCallLogsToDb:", error);
      throw error;
    }
  }

  //ye wala theek krenge
  async updateCallLogsToDb(callLogs, webHookType) {
    try {
      // Define the fields to update
      const updateFields = {
        companyID: callLogs.companyID,
        cuid: callLogs.cuid,
        callerDid: callLogs.callerDid,
        clientNumber: callLogs.clientNumber,
        incomingCallDid: callLogs.incomingCallDid,
        outgoingCallDid: callLogs.outgoingCallDid,
        callStartStamp: callLogs.callStartStamp,
        recordingLink: callLogs.recordingLink,
        agentid: callLogs.agentid,
        callStatus: callLogs.callStatus,
        callTranfer: callLogs.callTranfer,
        callTransferIds: callLogs.callTransferIds,
        department: callLogs.department,
        projects: callLogs.projects,
        accessGroups: callLogs.accessGroups,
        destinationID: callLogs.destinationID,
        destinationName: callLogs.destinationName,
        welcomeRecordingID: callLogs.welcomeRecordingID,
        onHoldRecordingID: callLogs.onHoldRecordingID,
        hangUpRecordingID: callLogs.hangUpRecordingID,
        isNewLeadCall: callLogs.isNewLeadCall,
        baseID: callLogs.baseID,
        isSmsSent: callLogs.isSmsSent,
        callDateTime: callLogs.callDateTime || callLogs.callStartStamp,
        advertisedNumber: callLogs.advertisedNumber,
        callDirection: callLogs.callDirection,
        endStamp: callLogs.endStamp,
        duration: callLogs.duration,
        source: callLogs.source,
        subsource: callLogs.subsource,
        stickyAgent: callLogs.stickyAgent,
        fromThisTeamOnly: callLogs.fromThisTeamOnly,
        ivrName: callLogs.ivrName,
        ivrId: callLogs.ivrId,
        incomingCallerMobileNumber: callLogs.incomingCallerMobileNumber,
        outgoingCallerMobileNumber: callLogs.outgoingCallerMobileNumber,
        incomingAgentMobileNumber: callLogs.incomingAgentMobileNumber,
        outgoingAgentMobileNumber: callLogs.outgoingAgentMobileNumber,
        agentName: callLogs.agentName,
        agentDesignation: callLogs.agentDesignation,
        callEndStamp: callLogs.callEndStamp,
        callAnswerStamp: callLogs.callAnswerStamp,
        hangUpCause: callLogs.hangUpCause,
        leadAssigned: callLogs.leadAssigned,
        clientName: callLogs.clientName,
        callId: callLogs.callId,
        provider: callLogs.provider,
        routing: callLogs.routing,
        afterCallSmsID: callLogs.afterCallSmsID,
        leadStatusType: callLogs.leadStatusType,
        callNotes: callLogs.callNotes,
        agentIDs: callLogs.agentIDs,
      };

      // Filter out undefined values
      const filteredFields = Object.entries(updateFields)
        .filter(([_, value]) => value !== undefined)
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});

      // Add webHookType specific updates
      if (webHookType === "callAnsweredByAgent") {
        filteredFields.currentCallStatus = "Started";
      }

      // Build dynamic SET clause
      const updateColumns = [];
      const values = [];
      let paramCount = 1;

      Object.entries(filteredFields).forEach(([key, value]) => {
        if (key !== "callId" && key !== "companyID") {
          updateColumns.push(`"${key}" = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      // Add WHERE clause parameters
      values.push(callLogs.callId);
      values.push(callLogs.companyID);

      const updateQuery = `
        UPDATE ${TableNames.CALL_COLLECTION}
        SET ${updateColumns.join(", ")}
        WHERE "callId" = $${paramCount} AND "companyID" = $${paramCount + 1}
        RETURNING *;
      `;

      console.log("Update Query:", { query: updateQuery, values });
      const result = await db.query(updateQuery, values);

      return {
        success: result.rowCount > 0,
        data: result.rows[0],
      };
    } catch (error) {
      console.error("Error updating call logs:", error);
      throw error;
    }
  }

  async updateCallLogsToDbWithRecording(callLogs, webHookType, recordingUrl) {
    try {
      console.log("Starting call logs update with recording:", {
        webHookType,
        recordingUrl,
      });

      // Handle recording upload if URL exists
      if (recordingUrl && webHookType === "hangUp") {
        try {
          const fileName = `${callLogs.callId}_recording.mp3`;
          const filePath = `companies/${callLogs.companyID}/call-recordings/${fileName}`;

          console.log("Attempting to upload recording:", {
            fileName,
            filePath,
            recordingUrl,
          });

          const uploadResult = await this.uploadCallRecording.uploadFile(
            fileName,
            recordingUrl,
            filePath
          );

          if (uploadResult) {
            // Directly use the method from tataCallingHelpers
            callLogs.recordingLink = {
              name: uploadResult.name || "",
              documentPath: uploadResult.documentPath || "",
              bucketName: uploadResult.bucketName || "",
              bucketProvider: uploadResult.bucketProvider || "",
              hashingCode: uploadResult.hashingCode || "",
              previewHashingCode: uploadResult.previewHashingCode || "",
              previewDocumentPath: uploadResult.previewDocumentPath || "",
            };
          }
        } catch (uploadError) {
          console.error("Error uploading recording:", uploadError);
        }
      }

      // Define fields to update
      const updateFields = {
        companyID: callLogs.companyID,
        cuid: callLogs.cuid,
        callerDid: callLogs.callerDid,
        clientNumber: callLogs.clientNumber,
        incomingCallDid: callLogs.incomingCallDid,
        outgoingCallDid: callLogs.outgoingCallDid,
        callStartStamp: callLogs.callStartStamp,
        recordingLink: callLogs.recordingLink,
        agentid: callLogs.agentid,
        callStatus: callLogs.callStatus,
        callTranfer: callLogs.callTranfer,
        callTransferIds: callLogs.callTransferIds,
        department: callLogs.department,
        projects: callLogs.projects,
        accessGroups: callLogs.accessGroups,
        destinationID: callLogs.destinationID,
        destinationName: callLogs.destinationName,
        welcomeRecordingID: callLogs.welcomeRecordingID,
        onHoldRecordingID: callLogs.onHoldRecordingID,
        hangUpRecordingID: callLogs.hangUpRecordingID,
        isNewLeadCall: callLogs.isNewLeadCall,
        baseID: callLogs.baseID,
        isSmsSent: callLogs.isSmsSent,
        callDateTime: callLogs.callDateTime || callLogs.callStartStamp,
        advertisedNumber: callLogs.advertisedNumber,
        callDirection: callLogs.callDirection,
        endStamp: callLogs.endStamp,
        duration: callLogs.duration,
        source: callLogs.source,
        subsource: callLogs.subsource,
        stickyAgent: callLogs.stickyAgent,
        fromThisTeamOnly: callLogs.fromThisTeamOnly,
        ivrName: callLogs.ivrName,
        ivrId: callLogs.ivrId,
        incomingCallerMobileNumber: callLogs.incomingCallerMobileNumber,
        outgoingCallerMobileNumber: callLogs.outgoingCallerMobileNumber,
        incomingAgentMobileNumber: callLogs.incomingAgentMobileNumber,
        outgoingAgentMobileNumber: callLogs.outgoingAgentMobileNumber,
        agentName: callLogs.agentName,
        agentDesignation: callLogs.agentDesignation,
        callEndStamp: callLogs.callEndStamp,
        callAnswerStamp: callLogs.callAnswerStamp,
        hangUpCause: callLogs.hangUpCause,
        leadAssigned: callLogs.leadAssigned,
        clientName: callLogs.clientName,
        callId: callLogs.callId,
        provider: callLogs.provider,
        routing: callLogs.routing,
        afterCallSmsID: callLogs.afterCallSmsID,
        leadStatusType: callLogs.leadStatusType,
        callNotes: callLogs.callNotes,
        agentIDs: callLogs.agentIDs,
      };

      // Filter out undefined values
      const filteredFields = Object.entries(updateFields)
        .filter(([_, value]) => value !== undefined)
        .reduce((acc, [key, value]) => {
          acc[key] = value;
          return acc;
        }, {});

      // Add webHookType specific updates
      if (webHookType === "callAnsweredByAgent") {
        filteredFields.currentCallStatus = "ongoing";
      } else if (webHookType === "hangUp") {
        filteredFields.currentCallStatus = "Ended";
      }

      // Build dynamic SET clause
      const updateColumns = [];
      const values = [];
      let paramCount = 1;

      Object.entries(filteredFields).forEach(([key, value]) => {
        if (key !== "callId" && key !== "companyID") {
          updateColumns.push(`"${key}" = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      // Add WHERE clause parameters
      values.push(callLogs.callId);
      values.push(callLogs.companyID);

      const updateQuery = `
        UPDATE ${TableNames.CALL_COLLECTION}
        SET ${updateColumns.join(", ")}
        WHERE "callId" = $${paramCount} AND "companyID" = $${paramCount + 1}
        RETURNING *;
      `;

      console.log("Update Query:", { query: updateQuery, values });
      const result = await db.query(updateQuery, values);

      return {
        success: result.rowCount > 0,
        data: result.rows[0],
      };
    } catch (error) {
      console.error("Error updating call logs with recording:", error);
      throw error;
    }
  }

  // async completeCallLogs(callLogs) {
  //   try {
  //     const cleanCallLogs = this.cleanObject(callLogs);
  //     const updateColumns = [];
  //     const values = [];
  //     let paramCount = 1;

  //     // Define fields that should be updated when completing
  //     const completionFields = {
  //       callStatus: cleanCallLogs.callStatus,
  //       currentCallStatus: "completed",
  //       callEndStamp: cleanCallLogs.callEndStamp,
  //       duration: cleanCallLogs.duration,
  //       hangUpCause: cleanCallLogs.hangUpCause,
  //       leadAssigned: cleanCallLogs.leadAssigned,
  //       callNotes: cleanCallLogs.callNotes,
  //     };

  //     Object.entries(completionFields).forEach(([key, value]) => {
  //       if (value !== undefined) {
  //         updateColumns.push(`"${key}" = $${paramCount}`);
  //         values.push(value);
  //         paramCount++;
  //       }
  //     });

  //     values.push(cleanCallLogs.callId);
  //     values.push(cleanCallLogs.companyID);

  //     const updateQuery = `
  //       UPDATE ${TableNames.CALL_COLLECTION}
  //       SET ${updateColumns.join(", ")}
  //       WHERE "callId" = $${paramCount} AND "companyID" = $${paramCount + 1}
  //       RETURNING *;
  //     `;

  //     const result = await db.query(updateQuery, values);
  //     return { success: result.rowCount > 0, data: result.rows[0] };
  //   } catch (error) {
  //     console.error("Error completing call logs:", error);
  //     throw error;
  //   }
  // }
}

const callLogsHelper = new CallLogsHelper();
module.exports = callLogsHelper;
