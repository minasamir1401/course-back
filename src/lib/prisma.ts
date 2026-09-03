import { PrismaClient } from '@prisma/client';

let dbUrl = process.env.DATABASE_URL || '';
if (dbUrl && !dbUrl.includes('connection_limit')) {
  const connectionLimit = process.env.DATABASE_CONNECTION_LIMIT || '15';
  const poolTimeout = process.env.DATABASE_POOL_TIMEOUT || '30';
  dbUrl += (dbUrl.includes('?') ? '&' : '?') + `connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`;
}

// Base Prisma Client
const basePrisma = new PrismaClient({
  datasources: {
    db: { url: dbUrl }
  }
});

// Create an extended Prisma Client for Global Soft Deletes
const prisma = basePrisma.$extends({
  query: {
    course: {
      async findMany({ args, query }) {
        if (args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findFirst({ args, query }) {
        if (args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findUnique({ args, query }) {
        if (args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async count({ args, query }) {
        if (args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async delete({ args, query }) {
        // Intercept delete and turn it into a soft delete (update)
        return basePrisma.course.update({
          where: args.where,
          data: { deletedAt: new Date() },
        }) as any;
      },
      async deleteMany({ args, query }) {
        return basePrisma.course.updateMany({
          where: args.where,
          data: { deletedAt: new Date() },
        }) as any;
      }
    },
    lesson: {
      async findMany({ args, query }) {
        if (args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findFirst({ args, query }) {
        if (args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async findUnique({ args, query }) {
        if (args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async count({ args, query }) {
        if (args.where?.deletedAt === undefined) {
          args.where = { ...args.where, deletedAt: null };
        }
        return query(args);
      },
      async delete({ args, query }) {
        return basePrisma.lesson.update({
          where: args.where,
          data: { deletedAt: new Date() },
        }) as any;
      },
      async deleteMany({ args, query }) {
        return basePrisma.lesson.updateMany({
          where: args.where,
          data: { deletedAt: new Date() },
        }) as any;
      }
    }
  }
});

export default prisma;
