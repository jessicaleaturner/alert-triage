import { createApp } from './app.ts';
import { createHttpServer } from './http-adapter.ts';
import { MemoryStore } from './store.ts';
import { Triage } from './triage.ts';

const port = Number(process.env.PORT ?? 3000);

const triage = new Triage(new MemoryStore());
const app = createApp(triage, { webhookToken: process.env.WEBHOOK_TOKEN });

createHttpServer(app).listen(port, () => {
  console.log(`alert-triage listening on port ${port}`);
  if (!process.env.WEBHOOK_TOKEN) {
    console.warn('WEBHOOK_TOKEN is not set: anyone who can reach this server can send and read alerts.');
  }
});
