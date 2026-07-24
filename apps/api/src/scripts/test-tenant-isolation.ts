import "../env.js";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TENANT_TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) throw new Error("TENANT_TEST_DATABASE_URL is required");
if (process.env.TENANT_TEST_CONFIRM !== "I_UNDERSTAND_THIS_WRITES_TEST_DATA") {
  throw new Error("Set TENANT_TEST_CONFIRM=I_UNDERSTAND_THIS_WRITES_TEST_DATA");
}
const parsedDatabaseUrl = new URL(testDatabaseUrl);
const databaseName = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ""));
if (!/(test|testing|ci|isolation)/i.test(databaseName)) {
  throw new Error("TENANT_TEST_DATABASE_URL database name must contain test, testing, ci, or isolation");
}
process.env.DATABASE_URL = testDatabaseUrl;
process.env.NODE_ENV = "test";

const [{ prisma, disconnectDatabase }, { getCatalogPart, listCatalogParts, CatalogError }] = await Promise.all([
  import("../db.js"),
  import("../catalog-service.js"),
]);

const runId = randomUUID();
const organizationIds = [`tenant-a-${runId}`, `tenant-b-${runId}`];
const userIds = [`user-a-${runId}`, `user-b-${runId}`];
const partId = `part-a-${runId}`;

try {
  await prisma.user.createMany({
    data: [
      { id: userIds[0]!, email: `tenant-a-${runId}@example.invalid` },
      { id: userIds[1]!, email: `tenant-b-${runId}@example.invalid` },
    ],
  });
  await prisma.organization.create({
    data: {
      id: organizationIds[0]!,
      name: "Tenant Isolation A",
      slug: `tenant-isolation-a-${runId}`,
      memberships: { create: { userId: userIds[0]!, role: "OWNER" } },
      parts: {
        create: {
          id: partId,
          sku: `ISO-${runId}`,
          normalizedSku: `ISO-${runId}`.toUpperCase(),
          primaryPartNumber: `PN-${runId}`,
          normalizedPartNumber: `PN-${runId}`.toUpperCase(),
          condition: "USED",
          createdById: userIds[0]!,
        },
      },
    },
  });
  await prisma.organization.create({
    data: {
      id: organizationIds[1]!,
      name: "Tenant Isolation B",
      slug: `tenant-isolation-b-${runId}`,
      memberships: { create: { userId: userIds[1]!, role: "OWNER" } },
    },
  });

  const ownPart = await getCatalogPart(organizationIds[0]!, partId);
  if (ownPart.id !== partId) throw new Error("Owning tenant could not read its fixture");

  let crossTenantReadRejected = false;
  try {
    await getCatalogPart(organizationIds[1]!, partId);
  } catch (error) {
    crossTenantReadRejected = error instanceof CatalogError && error.statusCode === 404;
  }
  if (!crossTenantReadRejected) throw new Error("Cross-tenant part lookup was not hidden as 404");

  const otherCatalog = await listCatalogParts(organizationIds[1]!, { sort: "newest", page: 1, pageSize: 25 });
  if (otherCatalog.parts.some((part) => part.id === partId)) throw new Error("Cross-tenant catalog list exposed another tenant's part");

  const crossTenantWrite = await prisma.part.updateMany({
    where: { id: partId, organizationId: organizationIds[1]! },
    data: { notes: "must never be written" },
  });
  if (crossTenantWrite.count !== 0) throw new Error("Cross-tenant scoped write changed another tenant's part");

  console.log(JSON.stringify({
    status: "passed",
    checks: ["own-tenant-read", "cross-tenant-detail-hidden", "cross-tenant-list-isolated", "cross-tenant-write-noop"],
    database: databaseName,
  }, null, 2));
} finally {
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
}
