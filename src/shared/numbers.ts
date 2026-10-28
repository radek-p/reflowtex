// SPDX-License-Identifier: AGPL-3.0-or-later
// Numbers as the project writes them in text: in its messages, and in the
// SVG a picture is rewritten to. It imports nothing, so it runs anywhere.

/** `x` to six significant digits, as short as that allows: 345, 0.5,
 *  12.3457, 0.00001 (no exponent below 1e21). */
export const g6 = (x: number): string => String(Number(x.toPrecision(6)));
