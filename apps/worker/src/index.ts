import { startCampaignProcessingWorker } from "./workers/campaign-processing.worker.js";
import { startEmailSendingWorker } from "./workers/email-sending.worker.js";

const workers = [startEmailSendingWorker(), startCampaignProcessingWorker()];

for (const worker of workers) {
  worker.on("completed", (job) => {
    console.log(`Completed ${worker.name} job ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`Failed ${worker.name} job ${job?.id}:`, error);
  });
}

console.log("QQueue workers started.");
