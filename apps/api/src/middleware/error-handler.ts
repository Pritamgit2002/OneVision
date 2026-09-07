import type { ErrorRequestHandler, RequestHandler } from 'express';
import { isHttpError, isIsolationViolation, messageOf, NotFoundError } from '../errors/http-error.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`No route for ${req.method} ${req.originalUrl}.`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (isIsolationViolation(err)) {
    console.error(messageOf(err));
    res.status(500).json({ error: messageOf(err) });
    return;
  }

  if (isHttpError(err)) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ error: messageOf(err) });
};
