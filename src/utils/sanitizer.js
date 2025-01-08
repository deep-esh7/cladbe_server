// src/utils/sanitizer.js

const sanitizer = {
  // Basic string sanitization
  sanitizeInput(str) {
    if (str === null || str === undefined) return null;
    return str.replace(/[<>{}()|&;]/g, "").trim();
  },

  // Number sanitization
  sanitizeNumber(val) {
    if (!val) return null;
    const parsed = parseInt(val);
    return isNaN(parsed) ? null : parsed;
  },

  // Email sanitization
  sanitizeEmail(email) {
    if (!email) return null;
    email = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) ? email : null;
  },

  // Phone number sanitization
  sanitizePhone(phone) {
    if (!phone) return null;
    const cleaned = phone.replace(/\D/g, "");
    const phoneRegex = /^\d{10,15}$/;
    return phoneRegex.test(cleaned) ? cleaned : null;
  },

  // Name sanitization
  sanitizeName(name) {
    if (!name) return null;
    const sanitized = name.replace(/[^a-zA-Z0-9\s\-'.]/g, "").trim();
    return sanitized.length > 0 ? sanitized : null;
  },

  // UUID sanitization
  sanitizeUUID(uuid) {
    if (!uuid) return null;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid) ? uuid.toLowerCase() : null;
  },

  // Array sanitization
  sanitizeArray(arr, itemSanitizer = this.sanitizeInput) {
    if (!Array.isArray(arr)) return null;
    const sanitized = arr
      .map((item) => itemSanitizer(item))
      .filter((item) => item !== null);
    return sanitized.length > 0 ? sanitized : null;
  },

  // SQL identifier sanitization
  sanitizeSQLIdentifier(identifier) {
    if (!identifier) return null;
    return identifier.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
  },

  // Sort direction sanitization
  sanitizeSortDirection(direction) {
    return direction?.toUpperCase() === "DESC" ? "DESC" : "ASC";
  },

  // Pagination parameter sanitization
  sanitizePagination(params = {}) {
    const { limit, offset } = params;
    return {
      limit: Math.min(Math.max(1, this.sanitizeNumber(limit) || 50), 100),
      offset: Math.max(0, this.sanitizeNumber(offset) || 0),
    };
  },

  // Lead object sanitization
  sanitizeLeadObject(lead) {
    if (!lead || typeof lead !== "object") return null;

    return {
      leadId: this.sanitizeUUID(lead.leadId),
      companyId: this.sanitizeInput(lead.companyId),
      ownerId: this.sanitizeInput(lead.ownerId),
      coOwnerIds: this.sanitizeArray(lead.coOwnerIds),
      mobileNumber: this.sanitizePhone(lead.mobileNumber),
      emailId: this.sanitizeEmail(lead.emailId),
      name: this.sanitizeName(lead.name),
      city: this.sanitizeInput(lead.city),
    };
  },

  // Search parameters sanitization
  sanitizeSearchParams(params = {}) {
    const {
      q,
      companyId,
      agentId,
      limit,
      startFrom,
      orderBy = "name",
      orderDir = "ASC",
    } = params;

    return {
      searchTerm: this.sanitizeInput(q),
      companyId: this.sanitizeInput(companyId),
      agentId: this.sanitizeInput(agentId),
      ...this.sanitizePagination({ limit, offset: startFrom }),
      orderBy: this.sanitizeSQLIdentifier(orderBy) || "name",
      orderDir: this.sanitizeSortDirection(orderDir),
    };
  },
};

module.exports = sanitizer;
