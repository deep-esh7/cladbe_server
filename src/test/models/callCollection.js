class CreateCallCollection {
  constructor({
    companyID,
    cuid,
    callerDid,
    clientNumber,
    incomingCallDid,
    outgoingCallDid,
    callStartStamp,
    recordingLink,
    agentid,
    callStatus,
    callTranfer,
    callTransferIds,
    department,
    projects,
    accessGroups,
    destinationID,
    destinationName,
    welcomeRecordingID,
    onHoldRecordingID,
    hangUpRecordingID,
    isNewLeadCall,
    baseID,
    isSmsSent,
    callDateTime,
    advertisedNumber,
    callDirection,
    endStamp,
    duration,
    source,
    subsource,
    stickyAgent,
    fromThisTeamOnly,
    ivrName,
    ivrId,
    incomingCallerMobileNumber,
    outgoingCallerMobileNumber,
    incomingAgentMobileNumber,
    outgoingAgentMobileNumber,
    agentName,
    agentDesignation,
    callEndStamp,
    callAnswerStamp,
    hangUpCause,
    leadAssigned,
    currentCallStatus,
    clientName,
    callId,
    provider,
    routing,
    afterCallSmsID,
    leadStatusType,
    callNotes,
    agentIDs,
  }) {
    this.companyID = companyID;
    this.cuid = cuid;
    this.callerDid = callerDid;
    (this.agentIDs = agentIDs), (this.clientNumber = clientNumber);
    this.incomingCallDid = incomingCallDid;
    this.outgoingCallDid = outgoingCallDid;
    this.callStartStamp = callStartStamp;
    this.recordingLink = recordingLink;
    this.agentid = agentid;
    this.callStatus = callStatus;
    this.callTranfer = callTranfer;
    this.callTransferIds = callTransferIds;
    this.department = department;
    this.projects = projects;
    this.accessGroups = accessGroups;
    this.destinationID = destinationID;
    this.destinationName = destinationName;
    this.welcomeRecordingID = welcomeRecordingID;
    this.onHoldRecordingID = onHoldRecordingID;
    this.hangUpRecordingID = hangUpRecordingID;
    this.isNewLeadCall = isNewLeadCall;
    this.baseID = baseID;
    this.isSmsSent = isSmsSent;
    this.callDateTime = callDateTime;
    this.advertisedNumber = advertisedNumber;
    this.callDirection = callDirection;
    this.endStamp = endStamp;
    this.duration = duration;
    this.source = source;
    this.subsource = subsource;
    this.stickyAgent = stickyAgent;
    this.fromThisTeamOnly = fromThisTeamOnly;
    this.ivrName = ivrName;
    this.ivrId = ivrId;
    this.incomingCallerMobileNumber = incomingCallerMobileNumber;
    this.outgoingCallerMobileNumber = outgoingCallerMobileNumber;
    this.incomingAgentMobileNumber = incomingAgentMobileNumber;
    this.outgoingAgentMobileNumber = outgoingAgentMobileNumber;
    this.agentName = agentName;
    this.agentDesignation = agentDesignation;
    this.callEndStamp = callEndStamp;
    this.callAnswerStamp = callAnswerStamp;
    this.hangUpCause = hangUpCause;
    this.leadAssigned = leadAssigned;
    this.currentCallStatus = currentCallStatus;
    this.clientName = clientName;
    this.callId = callId;
    this.provider = provider;
    this.routing = routing;
    this.afterCallSmsID = afterCallSmsID;
    this.leadStatusType = leadStatusType;
    this.callNotes = callNotes;
  }
  // Method to convert instance to a plain object
  toObject() {
    const obj = {
      companyID: this.companyID,
      cuid: this.cuid,
      callerDid: this.callerDid,
      clientNumber: this.clientNumber,
      incomingCallDid: this.incomingCallDid,
      outgoingCallDid: this.outgoingCallDid,
      callStartStamp: this.callStartStamp,
      recordingLink: this.recordingLink,
      agentid: this.agentid,
      callStatus: this.callStatus,
      callTranfer: this.callTranfer,
      callTransferIds: this.callTransferIds,
      department: this.department,
      projects: this.projects,
      accessGroups: this.accessGroups,
      destinationID: this.destinationID,
      destinationName: this.destinationName,
      welcomeRecordingID: this.welcomeRecordingID,
      onHoldRecordingID: this.onHoldRecordingID,
      hangUpRecordingID: this.hangUpRecordingID,
      isNewLeadCall: this.isNewLeadCall,
      baseID: this.baseID,
      isSmsSent: this.isSmsSent,
      callDateTime: this.callDateTime,
      advertisedNumber: this.advertisedNumber,
      callDirection: this.callDirection,
      endStamp: this.endStamp,
      duration: this.duration,
      source: this.source,
      subsource: this.subsource,
      stickyAgent: this.stickyAgent,
      fromThisTeamOnly: this.fromThisTeamOnly,
      ivrName: this.ivrName,
      ivrId: this.ivrId,
      incomingCallerMobileNumber: this.incomingCallerMobileNumber,
      outgoingCallerMobileNumber: this.outgoingCallerMobileNumber,
      incomingAgentMobileNumber: this.incomingAgentMobileNumber,
      outgoingAgentMobileNumber: this.outgoingAgentMobileNumber,
      agentName: this.agentName,
      agentDesignation: this.agentDesignation,
      callEndStamp: this.callEndStamp,
      callAnswerStamp: this.callAnswerStamp,
      hangUpCause: this.hangUpCause,
      leadAssigned: this.leadAssigned,
      currentCallStatus: this.currentCallStatus,
      clientName: this.clientName,
      callId: this.callId,
      provider: this.provider,
      routing: this.routing,
      afterCallSmsID: this.afterCallSmsID,
      leadStatusType: this.leadStatusType,
      callNotes: this.callNotes,
      agentIDs: this.agentIDs,
    };
    return obj;
  }
}

module.exports = { CreateCallCollection };
