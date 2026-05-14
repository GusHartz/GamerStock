import { z } from 'zod';
import { tradeRequestSchema } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  badRequest: z.object({
    message: z.string(),
  }),
};

export const api = {
  vaults: {
    list: {
      method: 'GET' as const,
      path: '/api/vaults' as const,
      input: z.object({
        page: z.coerce.number().optional().default(1),
        limit: z.coerce.number().optional().default(50),
        search: z.string().optional(),
        rank: z.string().optional(),
        region: z.string().optional(),
        sort: z.enum(['lastTradePrice', 'volume24h', 'performanceIndex', 'momentum']).optional(),
        order: z.enum(['asc', 'desc']).optional().default('desc'),
      }).optional(),
      responses: {
        200: z.any(), // PaginatedVaultsResponse
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/vaults/:id' as const,
      responses: {
        200: z.any(), // VaultDetailsResponse
        404: errorSchemas.notFound,
      },
    },
  },
  portfolio: {
    get: {
      method: 'GET' as const,
      path: '/api/portfolio' as const,
      responses: {
        200: z.any(), // PortfolioDetailsResponse
        401: errorSchemas.unauthorized,
        404: errorSchemas.notFound,
      },
    },
  },
  trade: {
    execute: {
      method: 'POST' as const,
      path: '/api/trade' as const,
      input: tradeRequestSchema,
      responses: {
        200: z.any(), // TradeResponse
        400: errorSchemas.badRequest,
        401: errorSchemas.unauthorized,
      },
    },
    recent: {
      method: 'GET' as const,
      path: '/api/trades/recent' as const,
      responses: {
        200: z.any(), // TradeWithVault[]
      },
    },
  },
  watchlist: {
    list: {
      method: 'GET' as const,
      path: '/api/watchlist' as const,
    },
    add: {
      method: 'POST' as const,
      path: '/api/watchlist' as const,
      input: z.object({ vaultId: z.number() }),
    },
    remove: {
      method: 'DELETE' as const,
      path: '/api/watchlist/:id' as const,
    }
  },
  seed: {
    execute: {
      method: 'POST' as const,
      path: '/api/seed' as const,
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
