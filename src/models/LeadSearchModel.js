class LeadSearchModel {
  constructor(data) {
    this.leadId = data.leadId;
    this.companyId = data.companyId;
    this.ownerId = data.ownerId;
    this.coOwnerIds = Array.isArray(data.coOwnerIds) ? data.coOwnerIds : [];
    this.mobileNumber = data.mobileNumber;
    this.emailId = data.emailId;
    this.name = data.name;
    this.city = data.city;
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date();
  }

  static fromObject(data) {
    return {
      companyId: data.companyId,
      ownerId: data.ownerId,
      coOwnerIds: data.coOwnerIds || [],
      mobileNumber: data.mobileNumber,
      emailId: data.emailId,
      name: data.name,
      city: data.city,
    };
  }

  toObject() {
    return {
      leadId: this.leadId,
      companyId: this.companyId,
      ownerId: this.ownerId,
      coOwnerIds: this.coOwnerIds,
      mobileNumber: this.mobileNumber,
      emailId: this.emailId,
      name: this.name,
      city: this.city,
      createdAt: this.createdAt,
    };
  }

  static validate(data) {
    const errors = [];

    if (!data.companyId) errors.push("Company ID is required");
    if (!data.ownerId) errors.push("Owner ID is required");
    if (!data.mobileNumber) errors.push("Mobile number is required");
    if (!data.emailId) errors.push("Email is required");
    if (!data.name) errors.push("Name is required");
    if (!data.city) errors.push("City is required");

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (data.emailId && !emailRegex.test(data.emailId)) {
      errors.push("Invalid email format");
    }

    // Validate mobile number format
    const mobileRegex = /^\+?[1-9]\d{9,14}$/;
    if (data.mobileNumber && !mobileRegex.test(data.mobileNumber)) {
      errors.push("Invalid mobile number format");
    }

    return errors;
  }
}

module.exports = LeadSearchModel;
