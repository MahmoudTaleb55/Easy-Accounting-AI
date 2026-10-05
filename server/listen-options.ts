/**
 * Build the options object for `httpServer.listen(...)`.
 *
 * `reusePort` maps to the OS SO_REUSEPORT socket option, which only exists on
 * Linux/BSD. On Windows (and with differing macOS semantics) passing it throws
 * `listen ENOTSUP` and crashes the server on boot. We therefore enable it only
 * on Linux — where a clustered deploy may run several processes bound to one
 * port — and omit it everywhere else so local dev on Windows/macOS works.
 * Single-process deploys are unaffected either way.
 *
 * Extracted from server/index.ts as a pure function so the platform decision
 * can be unit-tested without booting the whole server (Vite, DB, background
 * jobs). `platform` is injectable for exactly that reason.
 */
export interface ServerListenOptions {
  port: number;
  host: string;
  reusePort?: boolean;
}

export function buildListenOptions(
  port: number,
  host = "0.0.0.0",
  platform: NodeJS.Platform = process.platform,
): ServerListenOptions {
  const options: ServerListenOptions = { port, host };
  if (platform === "linux") {
    options.reusePort = true;
  }
  return options;
}
