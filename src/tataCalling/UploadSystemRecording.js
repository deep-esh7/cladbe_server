const axios = require("axios");
const Config = require("../../src/config");

class UploadSystemRecording {
  constructor() {
    if (!UploadSystemRecording.instance) {
      UploadSystemRecording.instance = this;
    }
    return UploadSystemRecording.instance;
  }

  async uploadAudioFile(companyId, fileId, fileName, fileLink, moh) {
    try {
      const jwtToken = "Bearer " + Config.EnvKeys.tataCalls;
      console.log("file id after receiving : " + fileId);

      const moh_status = moh === "0" ? 0 : 1;

      const postData = {
        audio_name: fileName,
        type: "url",
        data: fileLink,
        moh_status: moh_status,
      };

      console.log("Sending data:", postData);

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

      console.log("API Response:", response.data);

      if (response.status === 200) {
        await this.uploadAudioFileToTATA(
          companyId,
          fileId,
          response.data.batch_id
        );
        return {
          success: true,
          message: "Audio file uploaded successfully",
          data: response.data,
        };
      } else {
        throw new Error(response.statusText);
      }
    } catch (error) {
      console.error("Error uploading audio:", error.message);
      throw error;
    }
  }

  async uploadAudioFileToTATA(companyId, fileId, batchId) {
    let isRecordingReceived = false;

    const fetchAndUpdateRecording = async () => {
      console.log("Executing the function with a delay of 2 minutes");
      try {
        if (!isRecordingReceived) {
          const recordingId = await this.fetchRecordingIdFromTATA(batchId);
          if (recordingId !== null) {
            console.log("Recording ID received: " + recordingId);
            var tataFileId = recordingId.toString();
            await this.updateRecordingDocument(companyId, fileId, tataFileId);
            isRecordingReceived = true;
          } else {
            console.log(
              "Recording ID is still null. Trying again in 2 minutes..."
            );
            setTimeout(fetchAndUpdateRecording, 120000);
          }
        }
      } catch (error) {
        console.error("Error fetching recording ID:", error);
        throw error;
      }
    };

    setTimeout(fetchAndUpdateRecording, 120000);
  }

  async fetchRecordingIdFromTATA(batchId) {
    console.log("batchid:", batchId);
    const jwtToken = "Bearer " + Config.EnvKeys.tataCalls;

    try {
      const response = await axios.get(
        `https://api-smartflo.tatateleservices.com/v1/recording/batch_status/${batchId}/`,
        {
          headers: {
            Authorization: jwtToken,
            accept: "application/json",
          },
        }
      );

      console.log("Response : ", JSON.stringify(response.data));
      console.log(response.data.recording_id + " recording id ye hai");
      return response.data.recording_id;
    } catch (error) {
      console.error("Error making GET request:", error.message);
      return "Not Available";
    }
  }

  async updateRecordingDocument(companyId, fileId, tataFileId) {
    // Implement your recording document update logic here
    console.log("Updating recording document:", {
      companyId,
      fileId,
      tataFileId,
    });
  }
}

const uploadSystemRecording = new UploadSystemRecording();
module.exports = uploadSystemRecording;
