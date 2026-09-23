import { createApp } from "./app.js";
import { httpServerHandler } from "cloudflare:node";

const app = createApp();

app.listen(4000);

export default httpServerHandler({ port: 4000 });
