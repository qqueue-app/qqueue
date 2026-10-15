import type { Request, Response } from "express";
import { expect, it, vi } from "vitest";
vi.mock("./presence-service.js", () => ({
  replyPresenceService: { touch: vi.fn(), leave: vi.fn() },
}));
import { replyPresenceController } from "./presence-controller.js";
import { replyPresenceService } from "./presence-service.js";
const clientId = "80a062cb-bdd0-40e4-9ae0-70f7874d4635";
it("binds heartbeat and release to the authenticated caller and verified organization", async () => {
  const req = {
    params: { id: "m1" },
    organizationId: "o1",
    userId: "u1",
    body: { clientId, userId: "attacker" },
  } as unknown as Request;
  const res = { json: vi.fn() } as unknown as Response;
  await replyPresenceController.touch(req, res);
  expect(replyPresenceService.touch).toHaveBeenCalledWith(
    "m1",
    "o1",
    "u1",
    clientId
  );
  await replyPresenceController.leave(req, res);
  expect(replyPresenceService.leave).toHaveBeenCalledWith("o1", "u1", clientId);
});
it("rejects invalid client identities before accessing the service", async () => {
  await expect(
    replyPresenceController.touch(
      { body: { clientId: "unbounded" } } as Request,
      {} as Response
    )
  ).rejects.toThrow();
});
