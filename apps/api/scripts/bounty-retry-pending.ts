/**
 * Finish bounty payouts/refunds that are stuck: ledger rows left `failed`, or `pending` after a
 * crash. Safe to run repeatedly or from cron: see retryPendingSettlements in src/lib/tasks.ts.
 *
 *   DATABASE_URL=… X402_PLATFORM_PRIVATE_KEY=… pnpm bounty:retry-pending [--stale-sec 600]
 *
 * Keys come from env only and are never printed.
 */
import { retryPendingSettlements } from "@/lib/tasks";

const arg = process.argv.indexOf("--stale-sec");
const staleSec = arg > 0 ? Number(process.argv[arg + 1]) : undefined;

retryPendingSettlements({ staleSec })
  .then((results) => {
    if (!results.length) console.log("no failed or pending payouts/refunds");
    for (const r of results) console.log(JSON.stringify(r));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
