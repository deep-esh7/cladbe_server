const firebaseAdmin = require("firebase-admin");

class MediaService {
  static async uploadMedia(files, directoryPath) {
    const bucket = firebaseAdmin.storage().bucket();
    const urls = [];

    for (const file of files) {
      const blob = bucket.file(`${directoryPath}/${file.originalname}`);
      const blobStream = blob.createWriteStream({
        metadata: {
          contentType: file.mimetype,
        },
      });

      const urlPromise = new Promise((resolve, reject) => {
        blobStream.on("error", (err) => {
          console.error("Stream error:", err);
          reject(err);
        });

        blobStream.on("finish", async () => {
          try {
            await blob.makePublic();

            const url = `https://firebasestorage.googleapis.com/v0/b/${
              bucket.name
            }/o/${encodeURIComponent(blob.name)}?alt=media`;
            urls.push(url);
            resolve(url);
          } catch (err) {
            console.error(
              "Error making the file public or generating the URL:",
              err
            ); // Log errors
            reject(err);
          }
        });

        blobStream.end(file.buffer);
      });

      await urlPromise.catch((err) => console.error("Promise error:", err)); // Catch and log promise errors
    }

    return urls;
  }
  static async delete(filePath) {
    var bucket = firebaseAdmin.storage().bucket();
    var file = bucket.file(filePath);

    await file.delete();
  }
}

module.exports = { MediaService };
