const admin = require("../admin");
const NotificationHelpers = require("../NotificationService/helpers/NotificationHelpers"); // Adjust path as needed

class TriggerCallNotifications {
  constructor() {
    this.notificationHelpers = new NotificationHelpers();
  }

  async triggerNotification(notificationData, companyId, empId) {
    console.log("Notification Data Logging:", JSON.stringify(notificationData));
    console.log("Employee (LEAD OWNER EMP ID) Id Logging:", +empId);

    try {
      // Get the device tokens using NotificationHelpers instance
      const deviceTokens = await this.notificationHelpers.getDevicesTokens(
        companyId,
        empId
      );

      if (deviceTokens.length === 0) {
        console.log(
          "No device tokens found for the specified company and employee."
        );
        return;
      }

      // Rest of your existing code remains the same
      const message = {
        notification: {
          title: notificationData.title || "Title Is Empty",
          body: notificationData.body || "Body Is Empty",
        },
        data: {
          notificationType: notificationData.notificationType || "empty",
          projectData: JSON.stringify(notificationData.projectData) || "",
          clientName: notificationData.clientName || "",
          clientNumber: notificationData.clientNumber || "",
          leadStatus: notificationData.leadStatus || "",
          leadSubStatus: notificationData.leadSubStatus || "",
          triggerType: notificationData.triggerType || "initiate",
          companyId: notificationData.companyId || "",
          baseId: notificationData.baseId || "",
        },
      };

      const multicastMessage = {
        tokens: deviceTokens,
        ...message,
      };

      const response = await admin
        .messaging()
        .sendEachForMulticast(multicastMessage);

      console.log(
        `Notification Sent Successfully to ${response.successCount} devices.`
      );
      if (response.failureCount > 0) {
        console.log(
          `Failed to send notification to ${response.failureCount} devices.`
        );
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            console.log(
              `Failed token: ${deviceTokens[idx]} - Error: ${resp.error}`
            );
          }
        });
      }
    } catch (e) {
      console.log("Error sending notification:", e);
      throw e;
    }
  }
}

module.exports = TriggerCallNotifications;
