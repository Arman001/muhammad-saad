import helmet from 'helmet';

/**
 * Secure HTTP headers for a JSON-only API. The API never serves HTML, so the
 * Content-Security-Policy forbids loading anything from its responses.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31_536_000, includeSubDomains: true },
  referrerPolicy: { policy: 'no-referrer' },
});
