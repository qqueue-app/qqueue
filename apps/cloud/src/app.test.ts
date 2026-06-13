// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const app = createApp();

describe("cloud app wiring", () => {
  it("serves the health check", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "cloud" });
  });

  it("serves the plan catalog under /cloud/v1/billing/plans", async () => {
    const res = await request(app).get("/cloud/v1/billing/plans");
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { key: string }) => p.key)).toEqual([
      "free",
      "pro",
      "scale"
    ]);
  });

  it("returns 501 with a machine-readable code for unimplemented routes", async () => {
    const res = await request(app).post("/cloud/v1/billing/checkout");
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("not_implemented");
  });
});
