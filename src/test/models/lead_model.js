class Project {
  constructor({
    id = null,
    name = null,
    location = null,
    description = null,
    propertyTypes = [],
    minPrice = 0,
    maxPrice = 0,
    possession = null,
    features = [],
    amenities = [],
  }) {
    this.id = id;
    this.name = name;
    this.location = location;
    this.description = description;
    this.propertyTypes = propertyTypes;
    this.minPrice = minPrice;
    this.maxPrice = maxPrice;
    this.possession = possession;
    this.features = features;
    this.amenities = amenities;
  }

  toObject() {
    return {
      id: this.id,
      name: this.name,
      location: this.location,
      description: this.description,
      propertyTypes: this.propertyTypes,
      minPrice: this.minPrice,
      maxPrice: this.maxPrice,
      possession: this.possession,
      features: this.features,
      amenities: this.amenities,
    };
  }
}

class ChatParticipantsModel {
  constructor(id, name, designation, dpUrl, color) {
    this.id = id;
    this.name = name;
    this.designation = designation;
    this.dpUrl = dpUrl;
    this.color = color;
  }

  toObject() {
    return {
      id: this.id,
      name: this.name,
      designation: this.designation,
      dpUrl: this.dpUrl,
      color: this.color,
    };
  }
}

class ChatRoomModel {
  constructor(id, createdOn, participants) {
    this.id = id;
    this.createdOn = createdOn;
    this.participants = participants;
  }

  toObject() {
    return {
      id: this.id,
      createdOn: this.createdOn,
      participants: this.participants.map((participant) =>
        participant.toObject()
      ),
    };
  }
}

const ChatContentType = Object.freeze({
  NONE: { index: 0, value: "none" },
  AUDIO: { index: 1, value: "audio" },
  VIDEO: { index: 2, value: "video" },
  PHOTO: { index: 3, value: "photo" },
  DOCUMENT: { index: 4, value: "document" },
  TEXT: { index: 5, value: "text" },
  SYSTEM_GENERATED: { index: 6, value: "systemGenerated" },
});

const getContentTypeIndex = (contentTypeValue) => {
  const typeEntry = Object.values(ChatContentType).find(
    (type) => type.value === contentTypeValue
  );
  return typeEntry ? typeEntry.index : null;
};

class ChatModel {
  constructor({
    messageId,
    senderId,
    dateTime,
    contentType,
    contentUrl,
    text = null,
    deletedBy = null,
    deletedById = null,
    isDeleted = null,
    name,
    phoneNumber,
    photoUrl = null,
  }) {
    this.messageId = messageId;
    this.senderId = senderId;
    this.dateTime = dateTime;
    this.contentType = contentType;
    this.contentUrl = contentUrl;
    this.text = text;
    this.deletedBy = deletedBy;
    this.deletedById = deletedById;
    this.isDeleted = isDeleted;
    this.name = name;
    this.phoneNumber = phoneNumber;
    this.photoUrl = photoUrl;
  }

  toObject() {
    return {
      messageId: this.messageId,
      senderId: this.senderId,
      dateTime: this.dateTime,
      contentType: getContentTypeIndex(this.contentType),
      contentUrl: this.contentUrl,
      text: this.text,
      deletedBy: this.deletedBy,
      deletedById: this.deletedById,
      isDeleted: this.isDeleted,
      name: this.name,
      phoneNumber: this.phoneNumber,
      photoUrl: this.photoUrl,
    };
  }
}

class LeadOwner {
  constructor({ name = null, id = null, designation = null }) {
    this.name = name;
    this.id = id;
    this.designation = designation;
  }

  toObject() {
    return {
      name: this.name,
      id: this.id,
      designation: this.designation,
    };
  }
}

class LeadPersonalDetails {
  constructor({
    name,
    mobileNo,
    email = null,
    companyName = null,
    designation = "",
    industry = null,
    phone = null,
    gender = null,
    dpUrl = null,
  }) {
    this.name = name;
    this.mobileNo = mobileNo;
    this.email = email;
    this.companyName = companyName;
    this.designation = designation;
    this.industry = industry;
    this.phone = phone;
    this.gender = gender;
    this.dpUrl = dpUrl;
  }

  toObject() {
    return {
      name: this.name,
      mobileNo: this.mobileNo,
      email: this.email,
      companyName: this.companyName,
      designation: this.designation,
      industry: this.industry,
      phone: this.phone,
      gender: this.gender,
      dpUrl: this.dpUrl,
    };
  }
}

class FollowUp {
  constructor({
    id = null,
    date = null,
    type = null,
    status = null,
    note = null,
    createdBy = null,
  }) {
    this.id = id;
    this.date = date;
    this.type = type;
    this.status = status;
    this.note = note;
    this.createdBy = createdBy;
  }

  toObject() {
    return {
      id: this.id,
      date: this.date,
      type: this.type,
      status: this.status,
      note: this.note,
      createdBy: this.createdBy ? this.createdBy.toObject() : null,
    };
  }
}

class LeadStatusType {
  static UNALLOCATED = "Unallocated";
  static IN_CALL_CENTER = "In Call-Center";
  static FRESH = "Fresh";
  static INTERESTED = "Interested";
  static MEETING_DONE = "Meeting Done";
  static SITE_VISIT_SCHEDULED = "Site Visit Scheduled";
  static SITE_VISIT_DONE = "Site Visit Done";
  static NEGOTIATION = "Negotiation";
  static EOI = "EOI";
  static FAILED = "Failed";
  static JUNK = "Junk";

  static get allTypes() {
    return [
      LeadStatusType.UNALLOCATED,
      LeadStatusType.IN_CALL_CENTER,
      LeadStatusType.FRESH,
      LeadStatusType.INTERESTED,
      LeadStatusType.MEETING_DONE,
      LeadStatusType.SITE_VISIT_SCHEDULED,
      LeadStatusType.SITE_VISIT_DONE,
      LeadStatusType.NEGOTIATION,
      LeadStatusType.EOI,
      LeadStatusType.FAILED,
      LeadStatusType.JUNK,
    ];
  }
}

class StatusTrack {
  constructor({ status, date, duration = null }) {
    this.status = status;
    this.date = date;
    this.duration = duration;
  }

  toObject() {
    return {
      status: this.status,
      date: this.date,
      duration: this.duration,
    };
  }
}

class Lead {
  constructor({
    profilePicture = null,
    id = "456",
    projects = [],
    source = "",
    owner = null,
    coOwners = [],
    subsource = "",
    status = "",
    subStatus = "",
    personalDetails = {},
    purposeOfPurchase = "",
    interestedPropertyTypes = [],
    possession = "",
    startBudget = 0,
    endBudget = 0,
    firstProperty = false,
    note = "",
    hotLead = false,
    isAllocated = false,
    isClosed = false,
    createdOn = new Date(),
    followUps = [],
    statusTrack = [],
    leadState = "active",
    address = null,
    otherDetails = {},
  }) {
    this.profilePicture = profilePicture;
    this.id = id;
    this.projects = projects.map((project) =>
      project instanceof Project ? project : new Project(project)
    );
    this.source = source;
    this.owner =
      owner instanceof LeadOwner ? owner : new LeadOwner(owner || {});
    this.coOwners = coOwners.map((coOwner) =>
      coOwner instanceof LeadOwner ? coOwner : new LeadOwner(coOwner)
    );
    this.subsource = subsource;
    this.status = status;
    this.subStatus = subStatus;
    this.personalDetails =
      personalDetails instanceof LeadPersonalDetails
        ? personalDetails
        : new LeadPersonalDetails(personalDetails);
    this.purposeOfPurchase = purposeOfPurchase;
    this.interestedPropertyTypes = interestedPropertyTypes;
    this.possession = possession;
    this.startBudget = startBudget;
    this.endBudget = endBudget;
    this.firstProperty = firstProperty;
    this.note = note;
    this.hotLead = hotLead;
    this.isAllocated = isAllocated;
    this.isClosed = isClosed;
    this.createdOn =
      createdOn instanceof Date ? createdOn : new Date(createdOn);
    this.followUps = followUps.map((followUp) =>
      followUp instanceof FollowUp ? followUp : new FollowUp(followUp)
    );
    this.statusTrack = statusTrack.map((track) =>
      track instanceof StatusTrack ? track : new StatusTrack(track)
    );
    this.leadState = leadState;
    this.address = address;
    this.otherDetails = otherDetails;
  }

  toObject() {
    return {
      profilePicture: this.profilePicture
        ? this.profilePicture.toObject()
        : null,
      id: this.id,
      projects: this.projects.map((project) => project.toObject()),
      source: this.source,
      owner: this.owner ? this.owner.toObject() : null,
      coOwners: this.coOwners.map((coOwner) => coOwner.toObject()),
      subsource: this.subsource,
      status: this.status,
      subStatus: this.subStatus,
      personalDetails: this.personalDetails.toObject(),
      purposeOfPurchase: this.purposeOfPurchase,
      interestedPropertyTypes: this.interestedPropertyTypes,
      possession: this.possession,
      startBudget: this.startBudget,
      endBudget: this.endBudget,
      firstProperty: this.firstProperty,
      note: this.note,
      hotLead: this.hotLead,
      isAllocated: this.isAllocated,
      isClosed: this.isClosed,
      createdOn: this.createdOn.toISOString(),
      followUps: this.followUps.map((followUp) => followUp.toObject()),
      statusTrack: this.statusTrack.map((track) => track.toObject()),
      leadState: this.leadState,
      address: this.address ? this.address.toObject() : null,
      otherDetails: this.otherDetails,
    };
  }
}

module.exports = {
  Lead,
  Project,
  LeadOwner,
  LeadPersonalDetails,
  FollowUp,
  LeadStatusType,
  ChatParticipantsModel,
  ChatRoomModel,
  ChatModel,
  ChatContentType,
  StatusTrack,
};
