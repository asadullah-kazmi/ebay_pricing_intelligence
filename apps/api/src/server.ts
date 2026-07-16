import "dotenv/config";
import { app } from "./app.js";
import { getConfig } from "./config.js";

const { port, ebay } = getConfig();
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
console.log(`eBay provider: ${ebay.mode} (${ebay.environment})`);
