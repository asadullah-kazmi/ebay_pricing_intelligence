import "../env.js";
import { checkEbayConnection } from "../providers/ebay.js";

try {
  const result = await checkEbayConnection();
  console.log(`eBay authentication successful (${result.environment})`);
} catch (error) {
  console.error("eBay authentication failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
