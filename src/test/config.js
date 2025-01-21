class Config {
  static get EnvKeys() {
    return Object.freeze({
      tataCalls:
        "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0NTQ3MDgiLCJpc3MiOiJodHRwczovL2Nsb3VkcGhvbmUudGF0YXRlbGVzZXJ2aWNlcy5jb20vdG9rZW4vZ2VuZXJhdGUiLCJpYXQiOjE3MzQ2Nzg5NDMsImV4cCI6MjAzNDY3ODk0MywibmJmIjoxNzM0Njc4OTQzLCJqdGkiOiJaZW1OMGlJTHl5NzR5a1kyIn0.zT3WsIm14vj3LgQ5VlYcyvowrdJRp-Csq7c3ZqaHKEc",
      brevoEmails:
        "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",
    });
  }
}

// Use CommonJS export instead of ES Modules
module.exports = Config;
