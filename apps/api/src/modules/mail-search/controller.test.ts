import type { Request, Response } from "express";
import { beforeEach, expect, it, vi } from "vitest";
import { mailSearchController } from "./controller.js";
import { mailSearchService } from "./service.js";
import { sentService } from "../sent/service.js";
vi.mock("./service.js", () => ({
  mailSearchService: { search: vi.fn(), mailboxes: vi.fn() },
}));
vi.mock("../sent/service.js", () => ({ sentService: { get: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
it("uses verified membership for search, mailbox choices and queued message details", async () => {
  const req = {
    organizationId: "org1",
    userId: "u1",
    params: { id: "j1" },
    query: { q: "Question", view: "ALL" },
  } as unknown as Request;
  const response = { json: vi.fn() } as unknown as Response;
  await mailSearchController.search(req, response);
  expect(mailSearchService.search).toHaveBeenCalledWith("org1", "u1", {
    q: "Question",
    view: "ALL",
    limit: 25,
  });
  await mailSearchController.mailboxes(req, response);
  expect(mailSearchService.mailboxes).toHaveBeenCalledWith("org1", "u1");
  await mailSearchController.outgoing(req, response);
  expect(sentService.get).toHaveBeenCalledWith("j1", "org1", "u1", true);
});
it("rejects oversized queries", async () => {
  await expect(
    mailSearchController.search(
      { query: { q: "x".repeat(201) } } as unknown as Request,
      { json: vi.fn() } as unknown as Response
    )
  ).rejects.toThrow();
  expect(mailSearchService.search).not.toHaveBeenCalled();
});
