/**
 * Every unknown path under /api answers `application/problem+json`, never an
 * HTML page: agents and scanners probe paths such as /api/v1/does-not-exist.
 */
import { apiPreflight, apiRouteNotFound } from "@/lib/api/http";

export {
  apiPreflight as OPTIONS,
  apiRouteNotFound as DELETE,
  apiRouteNotFound as GET,
  apiRouteNotFound as PATCH,
  apiRouteNotFound as POST,
  apiRouteNotFound as PUT,
};
