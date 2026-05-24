import "dotenv/config";

import app from "./app";

const host = process.env.API_HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);

app.listen(port, host, () => {
  console.log(`API server listening on http://${host}:${port}`);
});
