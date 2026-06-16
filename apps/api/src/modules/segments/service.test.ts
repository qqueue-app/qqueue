import { describe, expect, it } from "vitest";
import { prismaMock } from "../../test/prisma-mock.js";
import { segmentContactWhere, segmentService } from "./service.js";

const ownedSegment = {
  id: "seg_1",
  organizationId: "org_1",
  name: "VIPs",
  description: null,
  rules: { field: "tags", match: "ANY", values: ["vip"] }
};

describe("segmentContactWhere", () => {
  it("ANDs the compiled rules with the org scope", () => {
    expect(
      segmentContactWhere("org_1", {
        field: "tags",
        match: "ANY",
        values: ["vip"]
      })
    ).toEqual({ organizationId: "org_1", tags: { hasSome: ["vip"] } });
  });

  it("adds an ACTIVE filter when activeOnly is set", () => {
    expect(
      segmentContactWhere(
        "org_1",
        { field: "emailDomain", eq: "example.com" },
        { activeOnly: true }
      )
    ).toEqual({
      organizationId: "org_1",
      status: "ACTIVE",
      email: { endsWith: "@example.com", mode: "insensitive" }
    });
  });
});

describe("segmentService", () => {
  it("lists segments newest first", () => {
    prismaMock.segment.findMany.mockResolvedValue([] as never);
    segmentService.list("org_1");
    expect(prismaMock.segment.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      orderBy: { createdAt: "desc" }
    });
  });

  it("creates a segment from the rule tree", () => {
    prismaMock.segment.create.mockResolvedValue(ownedSegment as never);
    segmentService.create({
      organizationId: "org_1",
      name: "VIPs",
      rules: { field: "tags", match: "ANY", values: ["vip"] }
    });
    expect(prismaMock.segment.create.mock.calls[0][0].data).toMatchObject({
      organizationId: "org_1",
      name: "VIPs"
    });
  });

  it("previews a rule tree with a count and sample", async () => {
    prismaMock.segment.findFirst.mockResolvedValue(null as never);
    prismaMock.contact.count.mockResolvedValue(7 as never);
    prismaMock.contact.findMany.mockResolvedValue([{ id: "c1" }] as never);
    const result = await segmentService.preview({
      organizationId: "org_1",
      rules: { field: "tags", match: "ANY", values: ["vip"] }
    });
    expect(result.count).toBe(7);
    expect(result.sample).toHaveLength(1);
    expect(prismaMock.contact.count).toHaveBeenCalledWith({
      where: { organizationId: "org_1", tags: { hasSome: ["vip"] } }
    });
  });

  it("updates a segment owned by the user", async () => {
    prismaMock.segment.findFirst.mockResolvedValue(ownedSegment as never);
    prismaMock.segment.update.mockResolvedValue(ownedSegment as never);
    await segmentService.update("seg_1", "user_1", {
      name: "VIP+",
      rules: { field: "status", eq: "ACTIVE" }
    });
    expect(prismaMock.segment.update).toHaveBeenCalledWith({
      where: { id: "seg_1" },
      data: expect.objectContaining({ name: "VIP+" })
    });
  });

  it("throws 404 acting on a segment the user does not own", async () => {
    prismaMock.segment.findFirst.mockResolvedValue(null as never);
    await expect(segmentService.get("seg_1", "user_1")).rejects.toThrow(
      "Segment not found"
    );
    await expect(segmentService.remove("seg_1", "user_1")).rejects.toThrow(
      "Segment not found"
    );
  });
});
