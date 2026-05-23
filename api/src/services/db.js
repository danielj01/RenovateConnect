const { PrismaClient } = require('@prisma/client');

const db = global.__db ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') global.__db = db;

module.exports = db;
