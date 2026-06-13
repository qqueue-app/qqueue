// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { createApp } from "./app.js";
import { env } from "./config/env.js";

const app = createApp();

app.listen(env.CLOUD_PORT, () => {
  console.log(`QQueue Cloud API listening on port ${env.CLOUD_PORT}`);
});
