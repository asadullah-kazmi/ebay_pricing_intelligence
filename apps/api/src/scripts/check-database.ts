import "../env.js";
import { disconnectDatabase, prisma } from "../db.js";

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  console.log("Database connection successful");
} catch (error) {
  console.error("Database connection failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
