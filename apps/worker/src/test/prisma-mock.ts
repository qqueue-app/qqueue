import type { PrismaClient } from "@prisma/client";
import { beforeEach, vi } from "vitest";
import {
  type DeepMockProxy,
  mockDeep,
  mockReset
} from "vitest-mock-extended";

// A single deep mock of the Prisma client, swapped in for the real singleton
// in `../lib/prisma.js`. Every worker test shares this so they never touch a
// real database. The mock factory is hoisted by Vitest above the imports.
export const prismaMock = mockDeep<PrismaClient>();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

// Make `prisma.$transaction(cb)` run the callback against the same mock, which
// is what the workers expect when they wrap writes in a transaction.
beforeEach(() => {
  mockReset(prismaMock);
  // @ts-expect-error - the deep mock's $transaction overloads are awkward to type here.
  prismaMock.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: typeof prismaMock) => unknown)(prismaMock)
      : Promise.all(arg as Promise<unknown>[])
  );
});

export type { DeepMockProxy };
