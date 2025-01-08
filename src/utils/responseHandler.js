class ResponseHandler {
    constructor(res) {
      this.res = res;
    }
  
    success(data, message = 'Success', statusCode = 200) {
      return this.res.status(statusCode).json({
        status: 'success',
        message,
        data
      });
    }
  
    error(message = 'Error', statusCode = 500, errors = null) {
      const response = {
        status: 'error',
        message
      };
  
      if (errors) {
        response.errors = errors;
      }
  
      return this.res.status(statusCode).json(response);
    }
  
    created(data, message = 'Created successfully') {
      return this.success(data, message, 201);
    }
  
    notFound(message = 'Resource not found') {
      return this.error(message, 404);
    }
  
    badRequest(message = 'Bad request', errors = null) {
      return this.error(message, 400, errors);
    }
  
    unauthorized(message = 'Unauthorized') {
      return this.error(message, 401);
    }
  
    forbidden(message = 'Forbidden') {
      return this.error(message, 403);
    }
  
    paginated(data, pagination) {
      return this.res.status(200).json({
        status: 'success',
        data,
        pagination: {
          ...pagination,
          hasMore: pagination.total > (pagination.page * pagination.limit)
        }
      });
    }
  }
  
  // Middleware to attach response handler to res object
  const attachResponseHandler = (req, res, next) => {
    res.handler = new ResponseHandler(res);
    next();
  };
  
  module.exports = {
    ResponseHandler,
    attachResponseHandler
  };