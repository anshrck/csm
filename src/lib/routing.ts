/**
 * URL-based routing helpers.
 *
 * Maps the in-app ViewKey + role to a real URL path so the workspace can be
 * deep-linked, refreshed, and navigated with the browser back/forward buttons.
 *
 * URL shape:
 *   /<role-prefix>/<view-path>           — list / dashboard
 *   /<role-prefix>/<view-path>/<id>      — detail view (demand / change / problem)
 *
 * Examples:
 *   /customer/dashboard
 *   /customer/demands/abc123
 *   /scm/demands
 *   /cm/approvals
 *   /owner/services
 */

import type { Role } from './types';
import type { ViewKey } from './store';

/** Maps each role to its URL prefix. */
export const ROLE_PREFIX: Record<Role, string> = {
  SERVICE_CUSTOMER: 'customer',
  SCM_WORKER: 'scm',
  CM_LEADER: 'cm',
  SERVICE_OWNER: 'owner',
};

/** Reverse lookup: URL prefix → Role. */
export const PREFIX_ROLE: Record<string, Role> = {
  customer: 'SERVICE_CUSTOMER',
  scm: 'SCM_WORKER',
  cm: 'CM_LEADER',
  owner: 'SERVICE_OWNER',
};

/**
 * Maps each ViewKey to a URL path segment.
 *
 * Detail views (demand-detail, change-detail) reuse their parent list path so
 * the URL reads naturally as `/scm/demands/abc123`. The presence of an `id`
 * parameter disambiguates list vs. detail.
 */
export const VIEW_PATH: Record<ViewKey, string> = {
  dashboard: 'dashboard',
  demands: 'demands',
  'demand-detail': 'demands',
  'submit-demand': 'submit-demand',
  catalog: 'catalog',
  sla: 'sla',
  changes: 'changes',
  'change-detail': 'changes',
  handovers: 'handovers',
  portfolio: 'services',
  governance: 'approvals',
  problems: 'problems',
  workers: 'workers',
  analytics: 'analytics',
  reports: 'reports',
  notifications: 'notifications',
  settings: 'settings',
  knowledge: 'knowledge',
  tickets: 'tickets',
  'ticket-detail': 'tickets',
};

/**
 * The set of view keys that represent a "detail" of a parent list view.
 * When the URL has an `id` segment, the parser converts the base view to its
 * detail counterpart.
 */
const DETAIL_VIEWS: Record<string, ViewKey> = {
  demands: 'demand-detail',
  changes: 'change-detail',
  tickets: 'ticket-detail',
};

/** Reverse map of VIEW_PATH (first write wins — list view takes priority over detail). */
const PATH_VIEW: Record<string, ViewKey> = (() => {
  const out: Record<string, ViewKey> = {};
  (Object.keys(VIEW_PATH) as ViewKey[]).forEach((k) => {
    const p = VIEW_PATH[k];
    if (!(p in out)) out[p] = k;
  });
  return out;
})();

export interface ParsedRoute {
  view: ViewKey;
  params: Record<string, string>;
  /** True if the URL's role prefix didn't match any known role. */
  unknownRole?: boolean;
  /** The role prefix parsed from the URL (if any). */
  prefix?: string;
}

/**
 * Parses an array of URL segments (as supplied by Next.js catch-all `params.slug`)
 * into a view + params.
 *
 * Segments: `[rolePrefix, viewPath, id?, ...]`. Any extra segments beyond the
 * id are ignored (they may be future sub-paths).
 */
export function pathToView(slug: string[] | undefined | null): ParsedRoute {
  if (!slug || slug.length === 0) {
    return { view: 'dashboard', params: {} };
  }

  const prefix = slug[0];
  const prefixKnown = prefix in PREFIX_ROLE;

  // Only `[rolePrefix]` → role root → dashboard.
  if (slug.length === 1) {
    return { view: 'dashboard', params: {}, prefix, unknownRole: !prefixKnown };
  }

  const viewSeg = slug[1];
  const baseView = PATH_VIEW[viewSeg];

  if (!baseView) {
    // Unknown path segment — fall back to dashboard rather than crash.
    return { view: 'dashboard', params: {}, prefix, unknownRole: !prefixKnown };
  }

  // Detail view: list-path + id segment.
  if (slug.length >= 3) {
    const detailView = DETAIL_VIEWS[viewSeg];
    if (detailView) {
      return { view: detailView, params: { id: slug[2] }, prefix, unknownRole: !prefixKnown };
    }
    // Non-list path with an id — keep id in params for the consumer to use.
    return { view: baseView, params: { id: slug[2] }, prefix, unknownRole: !prefixKnown };
  }

  return { view: baseView, params: {}, prefix, unknownRole: !prefixKnown };
}

/**
 * Converts a (role, view, params) tuple to a URL path.
 *
 * Detail views emit `/<prefix>/<list-path>/<id>`. Other params (besides `id`)
 * are appended as query-string filters so queue pages can be deep-linked too.
 */
export function viewToPath(
  role: Role,
  view: ViewKey,
  params: Record<string, string> = {},
): string {
  const prefix = ROLE_PREFIX[role];
  const pathSeg = VIEW_PATH[view] ?? 'dashboard';

  const segments = ['', prefix, pathSeg];

  // Detail views need an id segment.
  if (
    (view === 'demand-detail' || view === 'change-detail' || view === 'ticket-detail') &&
    params.id
  ) {
    segments.push(params.id);
  }

  let url = segments.join('/');
  // Strip trailing slash (defensive — should never happen with the above).
  if (url.length > 1 && url.endsWith('/')) url = url.slice(0, -1);

  // Carry over extra params (filters) as query string.
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (
      k === 'id' &&
      (view === 'demand-detail' || view === 'change-detail' || view === 'ticket-detail')
    ) continue;
    extra[k] = v;
  }
  const qs = new URLSearchParams(extra).toString();
  if (qs) url += `?${qs}`;
  return url;
}

/** Convenience: returns the dashboard URL for a given role. */
export function dashboardPath(role: Role): string {
  return `/${ROLE_PREFIX[role]}/dashboard`;
}

/** Returns true if a pathname looks like a workspace URL (starts with a known role prefix). */
export function isWorkspacePath(pathname: string): boolean {
  const seg = pathname.split('/').filter(Boolean)[0];
  return !!seg && seg in PREFIX_ROLE;
}
