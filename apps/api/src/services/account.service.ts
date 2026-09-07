import { listAccounts, type Account } from '@gl/core';
import { NotFoundError } from '../errors/http-error.js';

/** The chart of accounts is reference data: it has no tenant dimension at all. */
export function listAllAccounts(): Account[] {
  return listAccounts();
}

export function findAccount(accountId: number): Account {
  const account = listAccounts().find((a) => a.account_id === accountId);
  if (!account) throw new NotFoundError(`No account with id ${accountId}.`);
  return account;
}
