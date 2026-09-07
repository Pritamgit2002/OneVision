import 'dotenv/config';
import { bootstrap } from '@gl/core';
import { createApp } from './app.js';
import { env } from './config/env.js';

const summary = bootstrap();
console.log(
  `Ledger loaded: ${summary.transactions} transactions, ${summary.companies} companies, ` +
    `${summary.accounts} accounts, ${summary.budgetRows} budget rows.`,
);

createApp(summary).listen(env.port, () =>
  console.log(`API listening on http://localhost:${env.port}`),
);
