import { inngest } from './client';

export const cronIngest = inngest.createFunction(
  { id: 'cron-signal-ingestion' },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    await step.sendEvent('trigger-ingestion', {
      name: 'signals/ingest.requested',
      data: {},
    });
    return { triggered: true };
  },
);
