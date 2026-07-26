import "../env.js";
import { prisma } from "../db.js";

async function main() {
  const conn = await prisma.ebaySellerConnection.findFirst({
    include: { organization: { select: { name: true } } },
  });
  if (!conn) {
    console.log("No eBay seller connection found");
    return;
  }
  console.log(JSON.stringify({
    org: conn.organization.name,
    status: conn.status,
    ebayUserId: conn.ebayUserId,
    scopes: conn.scopes,
    hasCatalogScope: conn.scopes.some((scope) => scope.includes("commerce.catalog")),
    updatedAt: conn.updatedAt,
    connectedAt: conn.connectedAt,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
