import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

const app = createApp();
app.listen(config.port, () => {
  logger.info(`WTS Pay API listening on http://localhost:${config.port} (DEMO wallet - no real money)`);
});
