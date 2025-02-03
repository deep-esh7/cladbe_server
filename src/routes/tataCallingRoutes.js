const express = require("express");
const router = express.Router();
const { hangUp } = require("../tataCalling/hangUp");

const {
  CreateCallCollection,
} = require("../tataCalling/models/callCollection");

const uploadCallRecording = require("../tataCalling/tataCallingHelpers/UploadCallRecording");
const callLogsHelper = require("../Helpers/CallLogHelper");

// Webhook routes for Tata Calling
router.post("/webhook/hangup", hangUp);

router.post("/add-call-logs", async (req, res) => {
  try {
    const callCollection = new CreateCallCollection(req.body);
    await callLogsHelper.addCallLogsToDb(callCollection.toObject());

    res.status(200).json({
      success: true,
      message: "Call logs created successfully",
    });
  } catch (error) {
    console.error("Error in add call logs route:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Route for call recording upload
router.post("/upload-recording", async (req, res) => {
  try {
    const { fileName, fileUrl, filePath } = req.body;

    if (!fileName || !fileUrl || !filePath) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      });
    }

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
    console.error("Error in upload recording:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/update-call-logs", async (req, res) => {
  try {
    const { webHookType, fileUrl, ...callData } = req.body;
    const callCollection = new CreateCallCollection(callData);

    const result = await callLogsHelper.updateCallLogsToDb(
      callCollection.toObject(),
      webHookType,
      fileUrl
    );

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: "Call log not found",
      });
    }

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});
router.post("/upload-system-audio", async (req, res) => {
  try {
    const { companyId, fileId, fileName, fileLink, moh } = req.body;

    if (!companyId || !fileId || !fileName || !fileLink) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      });
    }

    const result = await uploadSystemRecording.uploadAudioFile(
      companyId,
      fileId,
      fileName,
      fileLink,
      moh
    );

    res.status(200).json(result);
  } catch (error) {
    console.error("Error in system audio upload:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
