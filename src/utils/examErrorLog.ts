type RequestLike = {
  method?: string;
  originalUrl?: string;
  url?: string;
  params?: unknown;
  query?: unknown;
  user?: {
    id?: string;
    role?: string;
    schoolId?: string | null;
  };
};

type PrismaErrorLike = Error & {
  code?: unknown;
  meta?: unknown;
  clientVersion?: unknown;
};

export function buildExamErrorLog(event: 'list' | 'detail', req: RequestLike, error: unknown) {
  const prismaError = error as PrismaErrorLike;
  const exception = error instanceof Error ? error : new Error(String(error));

  return {
    timestamp: new Date().toISOString(),
    event,
    request: {
      method: req.method || 'UNKNOWN',
      path: req.originalUrl || req.url || 'UNKNOWN',
      params: req.params || {},
      query: req.query || {},
      userId: req.user?.id || null,
      role: req.user?.role || null,
      schoolId: req.user?.schoolId || null,
    },
    error: {
      name: exception.name,
      message: exception.message,
      code: prismaError.code || null,
      meta: prismaError.meta || null,
      clientVersion: prismaError.clientVersion || null,
      stack: exception.stack || null,
    },
  };
}

export function logExamRequestError(event: 'list' | 'detail', req: RequestLike, error: unknown) {
  console.error('[exam-api-error]', JSON.stringify(buildExamErrorLog(event, req, error)));
}
