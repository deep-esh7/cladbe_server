const axios = require("axios");
const Config = require("../../src/config");
const db = require("../admin").firestore();

class UploadCallRecording {
  constructor() {
    if (!UploadCallRecording.instance) {
      UploadCallRecording.instance = this;
    }
    return UploadCallRecording.instance;
  }

  async uploadFile(fileName, fileUrl, filePath) {
    try {
      const jwtToken = "Bearer " + Config.EnvKeys.tataCalls;
      const postData = {
        audio_name: fileName,
        type: "url",
        data: fileUrl,
        moh_status: 0,
      };

      const response = await axios.post(
        "https://api-smartflo.tatateleservices.com/v1/recording",
        postData,
        {
          headers: {
            Authorization: jwtToken,
            "Content-Type": "application/json",
          },
        }
      );

      if (response.status === 200) {
        const [_, companyId] = filePath.match(/companies\/(.+?)\//) || [];
        await this.uploadAudioFileToTATA(
          companyId,
          fileName,
          response.data.batch_id
        );

        return {
          name: fileName,
          documentPath: filePath,
          bucketName: "",
          bucketProvider: "",
          hashingCode: "",
          previewHashingCode: "",
          previewDocumentPath: "",
        };
      }

      throw new Error("Failed to upload recording");
    } catch (error) {
      console.error("Error uploading recording:", error);
      throw error;
    }
  }

  async uploadAudioFileToTATA(companyId, fileId, batchId) {
    let isRecordingReceived = false;

    const fetchAndUpdateRecording = async () => {
      try {
        if (!isRecordingReceived) {
          const recordingId = await this.fetchRecordingIdFromTATA(batchId);
          if (recordingId !== null) {
            console.log("Recording ID received:", recordingId);
            const tataFileId = recordingId.toString();
            await this.updateRecordingDocument(companyId, fileId, tataFileId);
            isRecordingReceived = true;
          } else {
            console.log("Recording ID is null, retrying in 2 minutes");
            setTimeout(fetchAndUpdateRecording, 120000);
          }
        }
      } catch (error) {
        console.error("Error fetching recording ID:", error);
      }
    };

    setTimeout(fetchAndUpdateRecording, 120000);
  }

  async fetchRecordingIdFromTATA(batchId) {
    try {
      const response = await axios.get(
        `https://api-smartflo.tatateleservices.com/v1/recording/batch_status/${batchId}/`,
        {
          headers: {
            Authorization: "Bearer " + Config.EnvKeys.tataCalls,
            accept: "application/json",
          },
        }
      );
      return response.data.recording_id;
    } catch (error) {
      console.error("Error fetching recording ID:", error);
      return "Not Available";
    }
  }

  async updateRecordingDocument(companyId, fileId, tataFileId) {
    try {
      await db
        .collection("Companies")
        .doc(companyId)
        .collection("conversations")
        .doc("telephony")
        .collection("audioFiles")
        .doc(fileId)
        .update({
          recordingIdForTata: tataFileId,
        });
    } catch (error) {
      console.error("Error updating recording document:", error);
    }
  }
}

const uploadCallRecording = new UploadCallRecording();
module.exports = uploadCallRecording;
