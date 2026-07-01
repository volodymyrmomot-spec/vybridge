const { PrismaClient } = require("@prisma/client");

// Reuse a single client across hot reloads / requires instead of opening a
// new connection pool on every require() call.
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
