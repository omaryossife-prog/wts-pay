import type { RequestHandler } from "express";

const passThrough: RequestHandler = (_req, _res, next) => {
  next();
};

export const apiLimiter = passThrough;
export const authLimiter = passThrough;
export const transferLimiter = passThrough;
