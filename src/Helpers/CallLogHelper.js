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
      const checkQuery = `SELECT "callId" FROM ${TableNames.CALL_COLLECTION} WHERE "callId" = $1`;
      const checkResult = await db.query(checkQuery, [callLogs.callId]);
      console.log("Record check result:", checkResult.rows);

      if (checkResult.rows.length === 0) {
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
          callStatus: callLogs.callStatus || "new",
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
          callDateTime:
            callLogs.callDateTime || callLogs.callStartStamp || null,
          advertisedNumber: callLogs.advertisedNumber || null,
          callDirection: callLogs.callDirection || "inbound",
          endStamp: callLogs.endStamp || null,
          duration: callLogs.duration || 0,
          source: callLogs.source || null,
          subsource: callLogs.subsource || null,
          stickyAgent: callLogs.stickyAgent || false,
          fromThisTeamOnly: callLogs.fromThisTeamOnly || false,
          ivrName: callLogs.ivrName || null,
          ivrId: callLogs.ivrId || null,
          incomingCallerMobileNumber:
            callLogs.incomingCallerMobileNumber || null,
          outgoingCallerMobileNumber:
            callLogs.outgoingCallerMobileNumber || null,
          incomingAgentMobileNumber: callLogs.incomingAgentMobileNumber || null,
          outgoingAgentMobileNumber: callLogs.outgoingAgentMobileNumber || null,
          agentName: callLogs.agentName || null,
          agentDesignation: callLogs.agentDesignation || null,
          callEndStamp: callLogs.callEndStamp || null,
          callAnswerStamp: callLogs.callAnswerStamp || null,
          hangUpCause: callLogs.hangUpCause || null,
          leadAssigned: callLogs.leadAssigned || false,
          currentCallStatus: callLogs.currentCallStatus || "new",
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
      }
      return checkResult;
    } catch (error) {
      console.error("Error in addCallLogsToDb:", error);
      throw error;
    }
  }

  async updateCallLogsToDb(callLogs, webHookType) {
    try {
      const cleanCallLogs = this.cleanObject(callLogs);

      // Build dynamic SET clause based on available data
      const updateColumns = [];
      const values = [];
      let paramCount = 1;

      // Add each non-undefined field to the update
      Object.entries(cleanCallLogs).forEach(([key, value]) => {
        if (value !== undefined && key !== "callId" && key !== "companyID") {
          updateColumns.push(`"${key}" = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      // Add webHookType specific updates
      if (webHookType === "callAnsweredByAgent") {
        updateColumns.push(`"currentCallStatus" = $${paramCount}`);
        values.push("ongoing");
        paramCount++;
      }

      // Add WHERE clause parameters
      values.push(cleanCallLogs.callId);
      values.push(cleanCallLogs.companyID);

      const updateQuery = `
        UPDATE ${TableNames.CALL_COLLECTION} 
        SET ${updateColumns.join(", ")}
        WHERE "callId" = $${paramCount} AND "companyID" = $${paramCount + 1}
        RETURNING *;
      `;

      const result = await db.query(updateQuery, values);
      return { success: result.rowCount > 0, data: result.rows[0] };
    } catch (error) {
      console.error("Error updating call logs:", error);
      throw error;
    }
  }

  async completeCallLogs(callLogs) {
    try {
      const cleanCallLogs = this.cleanObject(callLogs);
      const updateColumns = [];
      const values = [];
      let paramCount = 1;

      // Define fields that should be updated when completing
      const completionFields = {
        callStatus: cleanCallLogs.callStatus,
        currentCallStatus: "completed",
        callEndStamp: cleanCallLogs.callEndStamp,
        duration: cleanCallLogs.duration,
        hangUpCause: cleanCallLogs.hangUpCause,
        leadAssigned: cleanCallLogs.leadAssigned,
        callNotes: cleanCallLogs.callNotes,
      };

      Object.entries(completionFields).forEach(([key, value]) => {
        if (value !== undefined) {
          updateColumns.push(`"${key}" = $${paramCount}`);
          values.push(value);
          paramCount++;
        }
      });

      values.push(cleanCallLogs.callId);
      values.push(cleanCallLogs.companyID);

      const updateQuery = `
        UPDATE ${TableNames.CALL_COLLECTION}
        SET ${updateColumns.join(", ")}
        WHERE "callId" = $${paramCount} AND "companyID" = $${paramCount + 1}
        RETURNING *;
      `;

      const result = await db.query(updateQuery, values);
      return { success: result.rowCount > 0, data: result.rows[0] };
    } catch (error) {
      console.error("Error completing call logs:", error);
      throw error;
    }
  }
}

const callLogsHelper = new CallLogsHelper();
module.exports = callLogsHelper;
