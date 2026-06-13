// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import { PrismaClient } from "@prisma/client";

// The cloud app shares the single generated Prisma client (one database, one
// schema, per docs/CLOUD_BOUNDARY.md). Core and cloud models both live on it;
// cloud-only access patterns stay in this app.
export const prisma = new PrismaClient();
