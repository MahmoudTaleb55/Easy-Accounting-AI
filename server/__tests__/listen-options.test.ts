import { describe, expect, it } from "vitest";
import { buildListenOptions } from "../listen-options";

/**
 * M2 regression: `reusePort` (SO_REUSEPORT) is Linux-only. Passing it on
 * Windows/macOS throws `listen ENOTSUP` and crashes the server on boot — the
 * exact failure observed in local Windows dev. buildListenOptions must only
 * set reusePort on Linux.
 */
describe("buildListenOptions (M2 reusePort platform guard)", () => {
  it("sets reusePort on Linux (clustered deploy support)", () => {
    const opts = buildListenOptions(5000, "0.0.0.0", "linux");
    expect(opts.reusePort).toBe(true);
    expect(opts.port).toBe(5000);
    expect(opts.host).toBe("0.0.0.0");
  });

  it("omits reusePort on Windows (would throw ENOTSUP)", () => {
    const opts = buildListenOptions(5000, "0.0.0.0", "win32");
    expect(opts.reusePort).toBeUndefined();
  });

  it("omits reusePort on macOS", () => {
    const opts = buildListenOptions(5000, "0.0.0.0", "darwin");
    expect(opts.reusePort).toBeUndefined();
  });

  it("passes through the given port and host", () => {
    const opts = buildListenOptions(8080, "127.0.0.1", "win32");
    expect(opts.port).toBe(8080);
    expect(opts.host).toBe("127.0.0.1");
  });
});
