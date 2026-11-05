import { resolve } from 'node:path';

/** Setting stored in the snapshot: the day it was taken, which the static demo then runs on. */
export const SNAPSHOT_DAY_SETTING = 'demo.today';

/** The static demo's data, written by `npm run demo:snapshot` and committed: the static build ships it. */
export const snapshotPath = (): string => resolve(import.meta.dirname, '../../demo/spendlens-demo.db.gz');
