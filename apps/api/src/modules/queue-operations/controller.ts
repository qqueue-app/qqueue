import type { Request, Response } from "express";
import { queueOperationsService } from "./service.js";

export const queueOperationsController = {
  async summary(_req: Request, res: Response) {
    const queues = await queueOperationsService.summary();
    res.json({ data: queues });
  },

  async retry(req: Request, res: Response) {
    const job = await queueOperationsService.retry(
      String(req.params.queueName),
      String(req.params.jobId)
    );
    res.json({ data: job });
  }
};
