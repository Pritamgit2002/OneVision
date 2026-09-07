import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { bootstrap } from '@gl/core';
import { router } from './routes/ask.js';

const summary = bootstrap();
console.log(
  `Ledger loaded: ${summary.transactions} transactions, ${summary.companies} companies, ` +
    `${summary.accounts} accounts, ${summary.budgetRows} budget rows.`,
);

const app = express();
app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use('/api', router);
app.get('/health', (_req, res) => res.json({ ok: true, ...summary }));

const port = Number(process.env['PORT'] ?? 4000);
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
