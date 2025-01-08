class AppError extends Error {
    constructor(message, statusCode = 500) {
      super(message);
      this.statusCode = statusCode;
      this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
      this.isOperational = true;
  
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  const handleDuplicateFieldsDB = (err) => {
    const field = err.detail.match(/Key \((.*?)\)=/)[1];
    const message = `Duplicate field value: ${field}. Please use another value!`;
    return new AppError(message, 400);
  };
  
  const handleValidationErrorDB = (err) => {
    const errors = Object.values(err.errors).map(el => el.message);
    const message = `Invalid input data. ${errors.join('. ')}`;
    return new AppError(message, 400);
  };
  
  const errorHandler = (err, req, res, next) => {
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';
  
    if (process.env.NODE_ENV === 'development') {
      res.status(err.statusCode).json({
        status: err.status,
        error: err,
        message: err.message,
        stack: err.stack
      });
    } else if (process.env.NODE_ENV === 'production') {
      if (err.code === '23505') err = handleDuplicateFieldsDB(err);
      if (err.name === 'ValidationError') err = handleValidationErrorDB(err);
  
      if (err.isOperational) {
        // Operational, trusted error: send message to client
        res.status(err.statusCode).json({
          status: err.status,
          message: err.message
        });
      } else {
        // Programming or other unknown error: don't leak error details
        console.error('ERROR 💥', err);
        res.status(500).json({
          status: 'error',
          message: 'Something went wrong!'
        });
      }
    }
  };
  
  module.exports = {
    AppError,
    errorHandler
  };