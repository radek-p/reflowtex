// SPDX-License-Identifier: AGPL-3.0-or-later
// The page's log, for the Log tab: its records (the viewer's host.log), and
// the row of the block a record is about.
import { I, host } from './context.ts';
import { blockId } from './ids.ts';
import type { LogRecord } from '../../../shared/log.ts';

/** The records after `after` (a seq); null when the viewer has no log. */
export function logs(after = 0): LogRecord[] | null {
    const log = host()?.log;
    return log ? log.records(after) : null;
}
/** The path to a block's row, by its key: null when no block on the page
 *  has it (a block mounted since, or gone). */
export function logBlock(key: string): number[] | null {
    const el = I.blocks().find(b => I.state(b)?.cache.blockKey === key);
    return el ? [blockId(el)] : null;
}
