import type { StringKey } from "@/i18n/dict";
import { ApiError } from "@/lib/queryClient";

/**
 * Map an unknown error thrown by `apiRequest` / `getQueryFn` to a localized
 * dictionary key (an `err_*` entry in `STRINGS`). Toast / notification call
 * sites use this so the UI surfaces a message in the active locale instead
 * of leaking the raw server `err.message` (which is often Arabic/bilingual
 * backend text) regardless of the chosen language.
 *
 * Full per-locale translation of individual server messages is out of scope;
 * this maps by HTTP status to a localized generic category, falling back to
 * `err_generic` for anything unrecognized.
 */
export function mapErrorKey(err: unknown): StringKey {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 400:
      case 422:
        return "err_validation";
      case 401:
        return "err_unauthorized";
      case 403:
        return "err_forbidden";
      case 404:
        return "err_not_found";
      case 409:
        return "err_conflict";
      case 429:
        return "err_rate_limited";
      case 408:
        return "err_timeout";
      default:
        if (err.status >= 500) return "err_server";
        return "err_generic";
    }
  }
  // Network / fetch failures surface as a TypeError with no status.
  if (err instanceof TypeError) return "err_network";
  return "err_generic";
}
