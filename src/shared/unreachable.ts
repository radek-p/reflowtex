// SPDX-License-Identifier: AGPL-3.0-or-later
// The end of a switch over a union that names every case. It imports
// nothing, so it runs anywhere.

/** For the default of a switch that has named every case: it compiles only
 *  while `x` can be nothing, so a case left out is a type error; reached at
 *  run time (data from elsewhere), it throws. */
export function unreachable(x: never, what: string): never {
    throw new Error(`unexpected ${what}: ${JSON.stringify(x)}`);
}
