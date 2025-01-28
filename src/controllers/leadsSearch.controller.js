const LeadSearchService = require("../services/leadsSearch.service");
const { sanitizeInput } = require("../middleware/validation");

// Common response format
const successResponse = (res, data, message = "Success", statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const errorResponse = (
  res,
  error,
  message = "An error occurred",
  statusCode = 500
) => {
  res.status(statusCode).json({
    success: false,
    error: error.message,
    details: message,
  });
};

// Input validation helpers
const validateRequiredFields = (data, fields) => {
  const missingFields = fields.filter((field) => !data[field]);
  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
  }
};

const sanitizeLeadData = (data) => {
  return {
    ...data,
    name: data.name ? sanitizeInput(data.name) : data.name,
    city: data.city ? sanitizeInput(data.city) : data.city,
    emailId: data.emailId ? data.emailId.toLowerCase() : data.emailId,
  };
};

class LeadSearchController {
  //sss
  constructor() {
    this.leadService = new LeadSearchService();
  }

  // Search Controllers
  searchByEmail = async (req, res) => {
    try {
      const { email, companyId } = req.query;
      validateRequiredFields({ email, companyId }, ["email", "companyId"]);

      const results = await this.leadService.searchByEmail(
        sanitizeInput(email),
        companyId
      );
      successResponse(res, results, "Email search completed successfully");
    } catch (error) {
      errorResponse(res, error, "Email search failed");
    }
  };

  searchByName = async (req, res) => {
    try {
      const {
        name,
        companyId,
        limit = 50,
        startFrom = 0,
        orderBy = "name",
        orderDir = "ASC",
      } = req.query;
      validateRequiredFields({ name, companyId }, ["name", "companyId"]);

      const results = await this.leadService.searchByName(
        sanitizeInput(name),
        companyId,
        {
          limit: parseInt(limit),
          offset: parseInt(startFrom),
          orderBy: sanitizeInput(orderBy),
          orderDir: orderDir.toUpperCase(),
        }
      );
      successResponse(res, results, "Name search completed successfully");
    } catch (error) {
      errorResponse(res, error, "Name search failed");
    }
  };

  searchByMobile = async (req, res) => {
    try {
      const { mobile, companyId } = req.query;
      validateRequiredFields({ mobile, companyId }, ["mobile", "companyId"]);

      const results = await this.leadService.searchByMobile(
        mobile, // Don't sanitize mobile as it needs specific format
        companyId
      );
      successResponse(res, results, "Mobile search completed successfully");
    } catch (error) {
      errorResponse(res, error, "Mobile search failed");
    }
  };

  // Universal Search
  universalSearch = async (req, res) => {
    try {
      const {
        q,
        companyId,
        agentId,
        limit = 50,
        startFrom = 0,
        orderBy = "name",
        orderDir = "ASC",
      } = req.query;
      validateRequiredFields({ q, companyId }, ["q", "companyId"]);

      const results = await this.leadService.universalSearch({
        searchTerm: sanitizeInput(q),
        companyId,
        agentId,
        limit: parseInt(limit),
        offset: parseInt(startFrom),
        orderBy: sanitizeInput(orderBy),
        orderDir: orderDir.toUpperCase(),
      });
      successResponse(res, results, "Universal search completed successfully");
    } catch (error) {
      errorResponse(res, error, "Universal search failed");
    }
  };

  universalSearchMyLeads = async (req, res) => {
    try {
      const {
        q: searchTerm,
        companyId,
        agentId,
        limit = 50,
        startFrom = 0,
        orderBy = "createdAt",
        orderDir = "DESC",
      } = req.query;

      validateRequiredFields({ searchTerm, companyId, agentId }, [
        "searchTerm",
        "companyId",
        "agentId",
      ]);

      const results = await this.leadService.universalSearchMyLeads({
        searchTerm: sanitizeInput(searchTerm),
        companyId,
        agentId,
        limit: parseInt(limit),
        offset: parseInt(startFrom),
        orderBy: sanitizeInput(orderBy),
        orderDir: orderDir.toUpperCase(),
      });
      successResponse(res, results, "My leads search completed successfully");
    } catch (error) {
      errorResponse(res, error, "My leads search failed");
    }
  };

  ////

  // CRUD Operations
  createLead = async (req, res) => {
    try {
      const leadData = req.body;
      validateRequiredFields(leadData, ["leadId", "mobileNumber", "companyId"]);

      const sanitizedData = sanitizeLeadData(leadData);
      const result = await this.leadService.createLead(sanitizedData);
      successResponse(res, result, "Lead created successfully", 201);
    } catch (error) {
      //
      errorResponse(res, error, "Failed to create lead");
    }
  };

  getAllLeads = async (req, res) => {
    try {
      const { companyId } = req.query;
      validateRequiredFields({ companyId }, ["companyId"]);

      const results = await this.leadService.getAllLeads(companyId);
      successResponse(res, results, "Leads retrieved successfully");
    } catch (error) {
      errorResponse(res, error, "Failed to retrieve leads");
    }
  };

  getLeadById = async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.query;
      validateRequiredFields({ id, companyId }, ["id", "companyId"]);

      const lead = await this.leadService.getLeadById(id, companyId);
      if (!lead) {
        return errorResponse(
          res,
          { message: "Lead not found" },
          "Lead not found",
          404
        );
      }
      successResponse(res, lead, "Lead retrieved successfully");
    } catch (error) {
      errorResponse(res, error, "Failed to retrieve lead");
    }
  };

  updateLead = async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.query;
      const updateData = req.body;

      validateRequiredFields({ id, companyId }, ["id", "companyId"]);
      if (!updateData || Object.keys(updateData).length === 0) {
        throw new Error("Update data is required");
      }

      const sanitizedData = sanitizeLeadData(updateData);
      const result = await this.leadService.updateLead(
        id,
        companyId,
        sanitizedData
      );
      successResponse(res, result, "Lead updated successfully");
    } catch (error) {
      errorResponse(res, error, "Failed to update lead");
    }
  };

  deleteLead = async (req, res) => {
    try {
      const { id } = req.params;
      const { companyId } = req.query;
      validateRequiredFields({ id, companyId }, ["id", "companyId"]);

      const result = await this.leadService.deleteLead(id, companyId);
      successResponse(res, result, "Lead deleted successfully");
    } catch (error) {
      errorResponse(res, error, "Failed to delete lead");
    }
  };

  // Admin Operations
  adminGetAllLeads = async (req, res) => {
    try {
      const {
        limit = 50,
        offset = 0,
        orderBy = "createdAt",
        orderDir = "DESC",
      } = req.query;
      const results = await this.leadService.adminGetAllLeads({
        limit: parseInt(limit),
        offset: parseInt(offset),
        orderBy: sanitizeInput(orderBy),
        orderDir: orderDir.toUpperCase(),
      });
      successResponse(res, results, "Admin: All leads retrieved successfully");
    } catch (error) {
      errorResponse(res, error, "Admin: Failed to retrieve leads");
    }
  };

  adminGetLeadById = async (req, res) => {
    try {
      const { id } = req.params;
      validateRequiredFields({ id }, ["id"]);

      const lead = await this.leadService.adminGetLeadById(id);
      if (!lead) {
        return errorResponse(
          res,
          { message: "Lead not found" },
          "Admin: Lead not found",
          404
        );
      }
      successResponse(res, lead, "Admin: Lead retrieved successfully");
    } catch (error) {
      errorResponse(res, error, "Admin: Failed to retrieve lead");
    }
  };

  adminUpdateLead = async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;

      validateRequiredFields({ id }, ["id"]);
      if (!updateData || Object.keys(updateData).length === 0) {
        throw new Error("Update data is required");
      }

      const sanitizedData = sanitizeLeadData(updateData);
      const result = await this.leadService.adminUpdateLead(id, sanitizedData);
      successResponse(res, result, "Admin: Lead updated successfully");
    } catch (error) {
      errorResponse(res, error, "Admin: Failed to update lead");
    }
  };

  adminDeleteLead = async (req, res) => {
    try {
      const { id } = req.params;
      validateRequiredFields({ id }, ["id"]);

      const result = await this.leadService.adminDeleteLead(id);
      successResponse(res, result, "Admin: Lead deleted successfully");
    } catch (error) {
      errorResponse(res, error, "Admin: Failed to delete lead");
    }
  };

  // Get Leads by Agent
  getLeadsByAgent = async (req, res) => {
    try {
      const {
        agentId,
        companyId,
        status,
        limit = 50,
        startFrom = 0,
        orderBy = "createdAt",
        orderDir = "DESC",
      } = req.query;

      validateRequiredFields({ agentId, companyId }, ["agentId", "companyId"]);

      const results = await this.leadService.getLeadsByAgent({
        agentId,
        companyId,
        status,
        limit: parseInt(limit),
        offset: parseInt(startFrom),
        orderBy: sanitizeInput(orderBy),
        orderDir: orderDir.toUpperCase(),
      });
      successResponse(res, results, "Agent leads retrieved successfully");
    } catch (error) {
      errorResponse(res, error, "Failed to retrieve agent leads");
    }
  };
}

module.exports = LeadSearchController;
