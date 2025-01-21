const { RealtimeDbDataModel } = require("../cloud_functions/db_model_helper/realtime_db_model");
const CollectionNames = require("../cloud_functions/utils/collection_names");
const { generateUniqueId } = require("../helpers/randomId");

class ChatroomService {

  async addMessageToChatRoom(leadId, compId, message) {
    var chat_model = {
      messageId: generateUniqueId(),
      senderId: compId,
      text: message,
      dateTime: new Date().toISOString(),
      contentType: 'systemGenerated',
      name: compId,
      phoneNumber: "1234567890",
    };
    console.log(`here message: ${chat_model}`);
    console.log(leadId);
    try {
      await new RealtimeDbDataModel(`${CollectionNames.COMPANY}/${compId}/${CollectionNames.LEADS}/${leadId}/${CollectionNames.CHATROOM}/primary`)
        .addData(chat_model, chat_model.messageId);
      console.log('Data added successfully');
    } catch (error) {
      console.error('Error adding data:', error);
    }
  }
}

module.exports = new ChatroomService();
