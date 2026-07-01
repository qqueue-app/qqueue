import { vi } from "vitest";

// The BullMQ queue singletons open a Redis connection at import time. Unit tests
// run without a Redis server, so importing any module that transitively pulls in
// a queue would otherwise emit connection-refused noise (and retry chatter).
//
// This global setup swaps the queue singletons for inert stubs so tests stay
// quiet and never touch Redis. Production code is untouched — the real queues
// are still created normally outside the test environment. Individual tests can
// still call vi.mock on a queue module to assert on specific queue interactions;
// their file-local mock takes precedence over these defaults.
const queueStub = vi.hoisted(() => () => ({
  add: vi.fn().mockResolvedValue(undefined),
  addBulk: vi.fn().mockResolvedValue([]),
  getJob: vi.fn().mockResolvedValue(undefined),
  getJobs: vi.fn().mockResolvedValue([]),
  getJobCounts: vi.fn().mockResolvedValue({}),
  upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
  removeJobScheduler: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../queues/email-sending.queue.js", () => ({
  emailSendingQueue: queueStub()
}));
vi.mock("../queues/campaign-processing.queue.js", () => ({
  campaignProcessingQueue: queueStub()
}));
vi.mock("../queues/webhook-delivery.queue.js", () => ({
  webhookDeliveryQueue: queueStub()
}));
