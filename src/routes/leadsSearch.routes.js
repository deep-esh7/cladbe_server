const express = require("express");
const router = express.Router();
const LeadSearchController = require("../controllers/leadsSearch.controller.js");
const { validateCompanyId } = require("../middleware/validation");

// Initialize controller
const leadController = new LeadSearchController();

// Search routes
router.get("/search/email", validateCompanyId, (req, res) =>
  leadController.searchByEmail(req, res)
);
router.get("/search/name", validateCompanyId, (req, res) =>
  leadController.searchByName(req, res)
);
router.get("/search/mobile", validateCompanyId, (req, res) =>
  leadController.searchByMobile(req, res)
);
router.get("/search/city", validateCompanyId, (req, res) =>
  leadController.searchByCity(req, res)
);
router.get("/search/company", (req, res) =>
  leadController.searchByCompany(req, res)
);
router.get("/search/universal", validateCompanyId, (req, res) =>
  leadController.universalSearch(req, res)
);
router.get("/search/universal/myLeads", validateCompanyId, (req, res) =>
  leadController.universalSearchMyLeads(req, res)
);

// Lead management routes
router.post("/", (req, res) => leadController.createLead(req, res));
router.get("/", validateCompanyId, (req, res) =>
  leadController.getAllLeads(req, res)
);
router.get("/byAgent", validateCompanyId, (req, res) =>
  leadController.getLeadsByAgent(req, res)
);
router.get("/byOwner", validateCompanyId, (req, res) =>
  leadController.getLeadsByOwner(req, res)
);
router.get("/byCoOwner", validateCompanyId, (req, res) =>
  leadController.getLeadsByCoOwner(req, res)
);
router.get("/:id", validateCompanyId, (req, res) =>
  leadController.getLeadById(req, res)
);
router.put("/:id", validateCompanyId, (req, res) =>
  leadController.updateLead(req, res)
);
router.delete("/:id", validateCompanyId, (req, res) =>
  leadController.deleteLead(req, res)
);

// Admin routes
router.get("/admin/leads", (req, res) =>
  leadController.adminGetAllLeads(req, res)
);
router.get("/admin/leads/:id", (req, res) =>
  leadController.adminGetLeadById(req, res)
);
router.put("/admin/leads/:id", (req, res) =>
  leadController.adminUpdateLead(req, res)
);
router.delete("/admin/leads/:id", (req, res) =>
  leadController.adminDeleteLead(req, res)
);

module.exports = router;
