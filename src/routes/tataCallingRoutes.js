const express = require("express");
const router = express.Router();
const { hangUp } = require("../tataCalling/hangUp");
const fetchAgentHandler = require("../tataCalling/fetchAgentData");
const {
  CreateCallCollection,
} = require("../tataCalling/models/callCollection");
const uploadCallRecording = require("../tataCalling/tataCallingHelpers/UploadCallRecording");
const callLogsHelper = require("../Helpers/CallLogHelper");
const tataCallingHelpers = require("../tataCalling/tataCallingHelpers/TataCallingHelpers");
const callHandler = require("../tataCalling/tataCallingHelpers/CallHandler");
const { callAnsweredByAgent } = require("../tataCalling/callAnsweredByAgent");

const {
  callAnsweredByCustomer,
} = require("../tataCalling/callAnsweredByCustomer");

// Middleware for request logging
const requestLogger = (req, res, next) => {
  console.log(`${req.method} ${req.path}`, {
    body: req.body,
    timestamp: new Date().toISOString(),
  });
  next();
};

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error("Error in route handler:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

// Validation middleware
const validateCallLogs = (req, res, next) => {
  const { call_id, companyID, callDirection } = req.body;
  if (!call_id || !companyID || !callDirection) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: call_id, companyID, or callDirection",
    });
  }
  next();
};

const validateRecordingUpload = (req, res, next) => {
  const { fileName, fileUrl, filePath } = req.body;
  if (!fileName || !fileUrl || !filePath) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: fileName, fileUrl, or filePath",
    });
  }
  next();
};

const validateSystemAudio = (req, res, next) => {
  const { companyId, fileId, fileName, fileLink } = req.body;
  if (!companyId || !fileId || !fileName || !fileLink) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required parameters: companyId, fileId, fileName, or fileLink",
    });
  }
  next();
};

// Apply middleware
router.use(requestLogger);

// Route handlers
router.post("/hangup", hangUp);

router.post("/call-answered-by-agent", async (req, res, next) => {
  try {
    await callAnsweredByAgent(req, res);
  } catch (error) {
    next(error);
  }
});
router.post("/call-answered-by-customer", async (req, res, next) => {
  try {
    await callAnsweredByCustomer(req, res);
  } catch (error) {
    next(error);
  }
});

router.post("/fetch-agent-data", async (req, res, next) => {
  try {
    await fetchAgentHandler.fetchAgentData(req, res);
  } catch (error) {
    next(error);
  }
});

router.post("/add-call-logs", validateCallLogs, async (req, res, next) => {
  try {
    const callData = await processCallData(req.body);
    const callCollection = new CreateCallCollection(callData);
    const result = await callLogsHelper.addCallLogsToDb(callCollection);

    if (!result?.rows?.length) {
      throw new Error("Failed to insert call log");
    }

    res.status(200).json({
      success: true,
      message: "Call logs created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

router.post("/update-call-logs", validateCallLogs, async (req, res, next) => {
  try {
    const { webHookType, fileUrl, ...callData } = req.body;

    // Process and format call data
    const processedData = await processCallData(callData);
    const callCollection = new CreateCallCollection(processedData);

    // Update call logs
    const result = await callLogsHelper.updateCallLogsToDb(
      callCollection,
      webHookType
    );

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: "Call log not found",
      });
    }

    res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/upload-recording",
  validateRecordingUpload,
  async (req, res, next) => {
    try {
      const { fileName, fileUrl, filePath } = req.body;
      const result = await uploadCallRecording.uploadFile(
        fileName,
        fileUrl,
        filePath
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/upload-system-audio",
  validateSystemAudio,
  async (req, res, next) => {
    try {
      const { companyId, fileId, fileName, fileLink, moh } = req.body;
      const result = await tataCallingHelpers.uploadAudioFile(
        companyId,
        fileId,
        fileName,
        fileLink,
        moh
      );

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Helper functions
async function processCallData(data) {
  const {
    call_id,
    caller_number,
    call_to_number,
    direction,
    answer_agent_number,
    call_status,
    missed_agent,
    ...restData
  } = data;

  // Format numbers using CallHandler
  const callerNumber =
    direction === "click_to_call"
      ? callHandler.formatIndianNumberWithPlus(call_to_number)
      : callHandler.formatIndianNumberWithPlus(caller_number);

  const callToNumber =
    direction === "click_to_call"
      ? callHandler.formatIndianNumberWithoutPlus(caller_number)
      : callHandler.formatIndianNumberWithoutPlus(call_to_number);

  const agentNumber = answer_agent_number
    ? callHandler.formatAgentNumber(
        answer_agent_number,
        call_status,
        direction,
        missed_agent
      )
    : "";

  return {
    ...restData,
    callId: tataCallingHelpers.convertCallId(call_id),
    callerNumber,
    callToNumber,
    agentNumber,
    recordingLink: tataCallingHelpers.getAppDocument(
      "",
      "",
      "",
      "",
      "",
      "",
      ""
    ),
  };
}

// Apply error handler
router.use(errorHandler);

module.exports = router;
