process.env.DEMO_MODE = process.env.DEMO_MODE || "true";

const appBundle = require("../artifacts/api-server/dist/app.cjs");

module.exports = appBundle.default || appBundle;
