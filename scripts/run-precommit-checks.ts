import { runCheck as roleGuard } from "./check-role-guard-coverage";
import { runCheck as migrationsPrefix } from "./check-migrations-prefix";
import { runCheck as devOnlyRoutes } from "./check-dev-only-routes-production-gate";
import { runCheck as reversalStamp } from "./check-reversal-stamp-backfill-coverage";

type Check = readonly [name: string, runCheck: () => { ok: boolean; message: string }];

const CHECKS: readonly Check[] = [
  ["role-guard-coverage", roleGuard],
  ["migrations-prefix", migrationsPrefix],
  ["dev-only-routes-production-gate", devOnlyRoutes],
  ["reversal-stamp-backfill-coverage", reversalStamp],
];

let failed = 0;
for (const [name, runCheck] of CHECKS) {
  try {
    const { ok, message } = runCheck();
    if (ok) {
      // eslint-disable-next-line no-console
      console.log(message);
    } else {
      // eslint-disable-next-line no-console
      console.error(`\n[${name}] FAILED:\n${message}\n`);
      failed += 1;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `\n[${name}] CRASHED:\n${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    failed += 1;
  }
}

process.exit(failed > 0 ? 1 : 0);
