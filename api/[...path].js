process.env.PUBLIC_MODE = "true";
process.env.DEMO_MODE = "false";

const appBundle = require("../artifacts/api-server/dist/app.cjs");

module.exports = appBundle.default || appBundle;
