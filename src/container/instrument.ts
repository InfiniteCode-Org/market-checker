// Import with `import * as Sentry from "@sentry/node"` if you are using ESM
const Sentry = require("@sentry/node");

console.log("Initializing Sentry...");

Sentry.init({
  dsn: "https://b04a57791f714ae87bf72e9f12e8d2d4@o4509690127187968.ingest.de.sentry.io/4509768874655824",

  // Setting this option to true will send default PII data to Sentry.
  // For example, automatic IP address collection on events
  sendDefaultPii: true,
  
  // Enable debug mode to see more detailed logs
  debug: false,
  
  // Set environment
  environment: process.env.NODE_ENV || "development",
  
  // Set release version
  release: "1.0.0",
});

console.log("Sentry initialized successfully");