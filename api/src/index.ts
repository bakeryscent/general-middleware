import { createApp } from "./app";
import { env } from "./config/env";

const app = createApp();

app.listen(env.port, ({ hostname, port }) => {
  console.log(`Middleware API running on http://${hostname}:${port} (${env.nodeEnv})`);
});
