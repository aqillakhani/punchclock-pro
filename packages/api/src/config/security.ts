import helmet from 'helmet';
import type { RequestHandler } from 'express';

/**
 * CSP for a pure JSON API: it never serves HTML, scripts, styles, or frames,
 * so the safest policy forbids loading anything. (The web app sets its own,
 * looser CSP that whitelists the API origin in `connect-src` — that belongs
 * on the page making requests, not on the API responses.)
 */
export const cspDirectives: Record<string, Iterable<string>> = {
  'default-src': ["'none'"],
  'base-uri': ["'none'"],
  'frame-ancestors': ["'none'"],
};

/**
 * Hardened Helmet configuration. Tightens the default CSP to `default-src
 * 'none'` and pins HSTS to one year with sub-domain coverage. All other
 * Helmet protections (nosniff, frameguard, hidePoweredBy, etc.) keep their
 * secure defaults.
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives,
    },
    hsts: {
      maxAge: 31_536_000, // 1 year
      includeSubDomains: true,
    },
  });
}
