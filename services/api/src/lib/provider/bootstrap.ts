/**
 * Provider bootstrap — importing this module registers all built-in adapters.
 * The gateway imports it once at startup so the registry is populated.
 */
import "./hosted-api.js";
import "./local-inference.js";
import "./harness-console.js";
