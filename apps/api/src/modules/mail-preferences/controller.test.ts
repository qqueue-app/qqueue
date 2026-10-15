import type { Request, Response } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { mailPreferenceController } from "./controller.js";
import { mailPreferenceService } from "./service.js";
vi.mock("./service.js", () => ({
  mailPreferenceService: { signatures: vi.fn(), saveSignature: vi.fn() },
}));
beforeEach(() => vi.clearAllMocks());
const res = () => ({ json: vi.fn() }) as unknown as Response;
it("uses the verified user and org for reads and writes", async () => {
  const req = {
    organizationId: "org1",
    userId: "u1",
    body: {
      smtpConnectionId: "smtp1",
      text: "Ama",
      enabled: true,
      expectedRevision: 0,
    },
  } as Request;
  vi.mocked(mailPreferenceService.signatures).mockResolvedValue([]);
  vi.mocked(mailPreferenceService.saveSignature).mockResolvedValue({
    revision: 1,
    text: "Ama",
    enabled: true,
    smtpConnectionId: "smtp1",
    userId: "u1",
  } as never);
  const response = res();
  await mailPreferenceController.signatures(req, response);
  expect(mailPreferenceService.signatures).toHaveBeenCalledWith("org1", "u1");
  await mailPreferenceController.saveSignature(req, response);
  expect(mailPreferenceService.saveSignature).toHaveBeenCalledWith(
    "org1",
    "u1",
    req.body
  );
  expect(response.json).toHaveBeenLastCalledWith({
    data: {
      revision: 1,
      text: "Ama",
      enabled: true,
      smtpConnectionId: "smtp1",
    },
  });
});
it("rejects an invalid revision before writing", async () => {
  await expect(
    mailPreferenceController.saveSignature(
      {
        body: {
          smtpConnectionId: "smtp1",
          text: "Ama",
          enabled: true,
          expectedRevision: -1,
        },
      } as Request,
      res()
    )
  ).rejects.toThrow();
  expect(mailPreferenceService.saveSignature).not.toHaveBeenCalled();
});
