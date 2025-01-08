const validateCompanyId = (req, res, next) => {
    const companyId = req.query.companyId;
    
    if (!companyId) {
      return res.status(400).json({
        error: 'CompanyId is required in query parameters'
      });
    }
  
    next();
  };
  
  const sanitizeInput = (str) => {
    if (str === null || str === undefined) return null;
    return str.replace(/[<>{}()|&;]/g, '').trim();
  };
  
  const validateSearchParams = (req, res, next) => {
    const { q, companyId } = req.query;
    
    if (!q || !companyId) {
      return res.status(400).json({
        error: 'Search term and Company ID are required',
        details: 'Please provide valid values for these fields'
      });
    }
  
    req.sanitizedQuery = {
      searchTerm: sanitizeInput(q),
      companyId: sanitizeInput(companyId)
    };
  
    next();
  };
  
  module.exports = {
    validateCompanyId,
    sanitizeInput,
    validateSearchParams
  };