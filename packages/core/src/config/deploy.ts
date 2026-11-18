/**
 * How long a site normally takes to show a commit, in milliseconds.
 *
 * Git stores the content the moment the commit lands; this is only the
 * deployment pipeline. Hosts show a "may take ~30 seconds to go live" notice
 * after a save and can override it with `deploy.propagationMs`.
 */
export const DEFAULT_DEPLOY_PROPAGATION_MS = 30_000
