export const logger = {
  info: (...args: unknown[]) => console.log(new Date().toISOString(), "[info]", ...args),
  warn: (...args: unknown[]) => console.warn(new Date().toISOString(), "[warn]", ...args),
  error: (...args: unknown[]) => console.error(new Date().toISOString(), "[error]", ...args),
};
