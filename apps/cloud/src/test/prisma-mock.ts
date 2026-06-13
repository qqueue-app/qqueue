// SPDX-License-Identifier: LicenseRef-QQueue-Commercial
// Copyright (C) 2026 Nana Aboagye Boateng
import type { PrismaClient } from "@prisma/client";
import { beforeEach, vi } from "vitest";
import {
  type DeepMockProxy,
  mockDeep,
  mockReset
} from "vitest-mock-extended";

// A single deep mock of the Prisma client, swapped in for the real singleton in
// `../lib/prisma.js` so cloud service tests never touch a database. Mirrors the
// core API's test harness.
export const prismaMock = mockDeep<PrismaClient>();

vi.mock("../lib/prisma.js", () => ({ prisma: prismaMock }));

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
