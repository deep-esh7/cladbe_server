class Config {
  static get EnvKeys() {
    return Object.freeze({
      tataCalls: process.env.TATA_CALLS_TOKEN || "",
      brevoEmails: process.env.BREVO_EMAILS_TOKEN || "",
    });
  }
}

module.exports = Config;

//  madsdas