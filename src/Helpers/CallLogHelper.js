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
    const cleanCallLogs = this.cleanObject(callLogs);
    try {
      const checkQuery = `SELECT callId FROM ${TableNames.CALL_COLLECTION} WHERE callId = $1`;
      const checkResult = await db.query(checkQuery, [cleanCallLogs.callId]);
      console.log("Record check result:", checkResult.rows);

      if (checkResult.rows.length === 0) {
        const query = `
          INSERT INTO ${TableNames.CALL_COLLECTION} (
            companyId, cuid, callerDid, clientNumber, incomingCallDid, 
            outgoingCallDid, callStartStamp, recordingLink, agentId, 
            callStatus, callTransfer, callTransferIds, department, 
            projects, accessGroups, destinationId, destinationName, 
            welcomeRecordingId, onHoldRecordingId, hangUpRecordingId, 
            isNewLeadCall, baseId, isSmsSent, callDateTime, 
            advertisedNumber, callDirection, endStamp, duration, 
            source, subsource, stickyAgent, fromThisTeamOnly, 
            ivrName, ivrId, incomingCallerMobileNumber, 
            outgoingCallerMobileNumber, incomingAgentMobileNumber, 
            outgoingAgentMobileNumber, agentName, agentDesignation, 
            callEndStamp, callAnswerStamp, hangUpCause, leadAssigned, 
            currentCallStatus, clientName, callId, provider, routing, 
            afterCallSmsId, leadStatusType, callNotes, agentIds
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
            $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
            $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35,
            $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46,
            $47, $48, $49, $50, $51, $52
          )
          RETURNING *;
        `;

        const values = [
          cleanCallLogs.companyId,
          cleanCallLogs.cuid,
          cleanCallLogs.callerDid,
          cleanCallLogs.clientNumber,
          cleanCallLogs.incomingCallDid,
          cleanCallLogs.outgoingCallDid,
          cleanCallLogs.callStartStamp,
          cleanCallLogs.recordingLink,
          cleanCallLogs.agentId,
          cleanCallLogs.callStatus,
          cleanCallLogs.callTransfer,
          cleanCallLogs.callTransferIds,
          cleanCallLogs.department,
          cleanCallLogs.projects,
          cleanCallLogs.accessGroups,
          cleanCallLogs.destinationId,
          cleanCallLogs.destinationName,
          cleanCallLogs.welcomeRecordingId,
          cleanCallLogs.onHoldRecordingId,
          cleanCallLogs.hangUpRecordingId,
          cleanCallLogs.isNewLeadCall,
          cleanCallLogs.baseId,
          cleanCallLogs.isSmsSent,
          cleanCallLogs.callDateTime,
          cleanCallLogs.advertisedNumber,
          cleanCallLogs.callDirection,
          cleanCallLogs.endStamp,
          cleanCallLogs.duration,
          cleanCallLogs.source,
          cleanCallLogs.subsource,
          cleanCallLogs.stickyAgent,
          cleanCallLogs.fromThisTeamOnly,
          cleanCallLogs.ivrName,
          cleanCallLogs.ivrId,
          cleanCallLogs.incomingCallerMobileNumber,
          cleanCallLogs.outgoingCallerMobileNumber,
          cleanCallLogs.incomingAgentMobileNumber,
          cleanCallLogs.outgoingAgentMobileNumber,
          cleanCallLogs.agentName,
          cleanCallLogs.agentDesignation,
          cleanCallLogs.callEndStamp,
          cleanCallLogs.callAnswerStamp,
          cleanCallLogs.hangUpCause,
          cleanCallLogs.leadAssigned,
          cleanCallLogs.currentCallStatus,
          cleanCallLogs.clientName,
          cleanCallLogs.callId,
          cleanCallLogs.provider,
          cleanCallLogs.routing,
          cleanCallLogs.afterCallSmsId,
          cleanCallLogs.leadStatusType,
          cleanCallLogs.callNotes,
          cleanCallLogs.agentIds,
        ];

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

  async updateCallLogsToDb(callLogs) {
    try {
      const cleanCallLogs = this.cleanObject(callLogs);

      const updateQuery = `
        UPDATE ${TableNames.CALL_COLLECTION} 
        SET 
          callStatus = $1,
          currentCallStatus = $2,
          agentId = $3,
          agentName = $4,
          agentDesignation = $5,
          callTransfer = $6,
          callTransferIds = $7,
          department = $8,
          projects = $9,
          accessGroups = $10,
          destinationId = $11,
          destinationName = $12,
          updatedAt = CURRENT_TIMESTAMP
        WHERE callId = $13 AND companyId = $14
        RETURNING *;
      `;

      const values = [
        cleanCallLogs.callStatus,
        "ongoing",
        cleanCallLogs.agentId,
        cleanCallLogs.agentName,
        cleanCallLogs.agentDesignation,
        cleanCallLogs.callTransfer,
        cleanCallLogs.callTransferIds,
        cleanCallLogs.department,
        cleanCallLogs.projects,
        cleanCallLogs.accessGroups,
        cleanCallLogs.destinationId,
        cleanCallLogs.destinationName,
        cleanCallLogs.callId,
        cleanCallLogs.companyId,
      ];

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
      const updateQuery = `
        UPDATE ${TableNames.CALL_COLLECTION}
        SET
          callStatus = $1,
          currentCallStatus = $2,
          callEndStamp = $3,
          duration = $4,
          hangUpCause = $5,
          leadAssigned = $6,
          callNotes = $7,
          updatedAt = CURRENT_TIMESTAMP
        WHERE callId = $8 AND companyId = $9
        RETURNING *;
      `;

      const values = [
        cleanCallLogs.callStatus,
        "completed",
        cleanCallLogs.callEndStamp,
        cleanCallLogs.duration,
        cleanCallLogs.hangUpCause,
        cleanCallLogs.leadAssigned,
        cleanCallLogs.callNotes,
        cleanCallLogs.callId,
        cleanCallLogs.companyId,
      ];

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

const createTableQuery = `
CREATE TABLE IF NOT EXISTS ${TableNames.CALL_COLLECTION} (
    id SERIAL PRIMARY KEY,
    companyId VARCHAR(255) NOT NULL,
    cuid VARCHAR(255),
    callerDid VARCHAR(255),
    clientNumber VARCHAR(255),
    incomingCallDid VARCHAR(255),
    outgoingCallDid VARCHAR(255),
    callStartStamp TIMESTAMP,
    recordingLink JSONB,
    agentId VARCHAR(255),
    callStatus VARCHAR(50),
    callTransfer BOOLEAN,
    callTransferIds TEXT[],
    department VARCHAR(255),
    projects JSONB,
    accessGroups TEXT[],
    destinationId VARCHAR(255),
    destinationName VARCHAR(255),
    welcomeRecordingId VARCHAR(255),
    onHoldRecordingId VARCHAR(255),
    hangUpRecordingId VARCHAR(255),
    isNewLeadCall BOOLEAN,
    baseId VARCHAR(255),
    isSmsSent BOOLEAN,
    callDateTime TIMESTAMP,
    advertisedNumber VARCHAR(255),
    callDirection VARCHAR(50),
    endStamp TIMESTAMP,
    duration INTEGER,
    source VARCHAR(255),
    subsource VARCHAR(255),
    stickyAgent BOOLEAN,
    fromThisTeamOnly BOOLEAN,
    ivrName VARCHAR(255),
    ivrId VARCHAR(255),
    incomingCallerMobileNumber VARCHAR(255),
    outgoingCallerMobileNumber VARCHAR(255),
    incomingAgentMobileNumber VARCHAR(255),
    outgoingAgentMobileNumber VARCHAR(255),
    agentName VARCHAR(255),
    agentDesignation VARCHAR(255),
    callEndStamp TIMESTAMP,
    callAnswerStamp TIMESTAMP,
    hangUpCause VARCHAR(255),
    leadAssigned BOOLEAN,
    currentCallStatus VARCHAR(50),
    clientName VARCHAR(255),
    callId VARCHAR(255) UNIQUE NOT NULL,
    provider VARCHAR(255),
    routing JSONB,
    afterCallSmsId VARCHAR(255),
    leadStatusType VARCHAR(50),
    callNotes TEXT,
    agentIds TEXT[],
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

db.query(createTableQuery).catch(console.error);
