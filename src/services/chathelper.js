const { generateUniqueId } = require("../helpers/randomId");
const { ChatRoomModel, ChatModel, ChatContentType } = require("../tataCalling/models/lead_model");

function createChatRoomModel(participantsList) {
    if (!Array.isArray(participantsList)) {
        throw new Error('participantsList must be an array');
    }
    return new ChatRoomModel(
        generateUniqueId(),
        new Date().toISOString(),
        participantsList
    );
}

function createChatMessage(companyName, companyId, text) {
    const messageId = generateUniqueId();

    const currentDate = new Date();

    // Formatting the date to 'YYYY-MM-DD HH:mm:ss.SSS'
    const formattedDateTime = currentDate.toISOString().replace('T', ' ').slice(0, -1);

    return new ChatModel({
        messageId: messageId,
        senderId: companyId,
        dateTime: formattedDateTime,
        contentType: ChatContentType.SYSTEM_GENERATED.value,
        contentUrl: '',
        text: text,
        name: companyName,
        phoneNumber: ""
    });
}

module.exports = { createChatRoomModel, createChatMessage };