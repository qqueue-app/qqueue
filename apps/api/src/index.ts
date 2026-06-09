import { env } from "./config/env.js";
import { createApp } from "./app.js";

const app = createApp();

app.listen(env.API_PORT, () => {
  console.log(`QQueue API listening on http://localhost:${env.API_PORT}`);
});
