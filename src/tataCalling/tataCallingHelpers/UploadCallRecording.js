  class UploadCallRecording {
    constructor() {
      if (!UploadCallRecording.instance) {
        UploadCallRecording.instance = this;
      }
      return UploadCallRecording.instance;
    }

    async uploadFile(fileName, fileUrl, filePath) {
      try {
        const apiUrl = "https://fileuploader.amiltusgroup.workers.dev/upload";
        const data = {
          fileUrl: fileUrl,
          filePath: filePath,
          fileName: fileName,
        };

        const maxRetries = 10;
        const delay = 30000; // 30 seconds

        console.log("Starting file upload with URL:", fileUrl);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`Upload attempt ${attempt} of ${maxRetries}`);

            const response = await fetch(apiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(data),
            });

            const result = await response.json();

            if (
              response.ok &&
              result &&
              result.message.includes(`File uploaded successfully`)
            ) {
              console.log(`File successfully uploaded to: ${filePath}`);
              return result;
            } else {
              console.log(`Attempt ${attempt} failed: ${result.message}`);
            }
          } catch (error) {
            console.error(`Attempt ${attempt} error during file upload:`, {
              error: error.message,
              stack: error.stack,
              fileName,
              filePath,
            });
          }

          if (attempt < maxRetries) {
            console.log(`Retrying in ${delay / 1000} seconds...`);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }

        throw new Error("Failed to upload file after maximum retries.");
      } catch (error) {
        console.error("Error in uploadFile:", error);
        throw error;
      }
    }
  }

  // Create and export singleton instance
  const uploadCallRecording = new UploadCallRecording();
  module.exports = uploadCallRecording;
