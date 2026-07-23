import "dotenv/config";

import app from "./app";
import { getConfig } from "./config";

const { apiHost, apiPort } = getConfig();

app.listen(apiPort, apiHost, () => {
  console.log(`API server listening on http://${apiHost}:${apiPort}`);
});
