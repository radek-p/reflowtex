// SPDX-License-Identifier: AGPL-3.0-or-later
// A bitmap glyph as outlines: the boundary of its ink, pixel edge by pixel
// edge, joined into closed contours and each straight run made one line –
// so a glyph is a handful of polygons, its holes among them, and the browser
// draws it as exactly the bitmap at any size. With y up, an outer contour
// runs anticlockwise and a hole clockwise, as PostScript fonts have them.

/** A contour's corners, in pixels: x right and y up from the glyph's
 *  reference point. */
export type Contour = [number, number][];

/** `rows` top to bottom, 1 for ink; the reference point `hoff` pixels right
 *  of the top-left pixel's left edge and `voff` below its top edge. */
export function pixelContours(rows: Uint8Array[], hoff: number, voff: number): Contour[] {
  const h = rows.length, w = h ? rows[0].length : 0;
  const ink = (r: number, c: number) => r >= 0 && r < h && c >= 0 && c < w && rows[r][c] === 1;
  // Directed edges between grid corners (X right, Y down), ink on the right:
  // from each corner, the edges leaving it (a corner two pixels meet at
  // diagonally has two).
  const key = (x: number, y: number) => y * (w + 1) + x;
  const out = new Map<number, [number, number][]>();
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push([x1, y1]);
  };
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (!ink(r, c)) continue;
    if (!ink(r - 1, c)) edge(c, r, c + 1, r);             // top, left to right
    if (!ink(r, c + 1)) edge(c + 1, r, c + 1, r + 1);     // right, downwards
    if (!ink(r + 1, c)) edge(c + 1, r + 1, c, r + 1);     // bottom, right to left
    if (!ink(r, c - 1)) edge(c, r + 1, c, r);             // left, upwards
  }
  const contours: Contour[] = [];
  for (const start of [...out.keys()].sort((a, b) => a - b)) {
    while (out.get(start)?.length) {
      const pts: [number, number][] = [];
      let x = start % (w + 1), y = Math.floor(start / (w + 1)), dx = 0, dy = 0;
      for (;;) {
        const k = key(x, y), next = out.get(k);
        if (!next || !next.length) break;
        // Where two edges leave a corner, take the turn towards the ink (a
        // right turn on the bitmap): pixels that only touch at a corner stay
        // separate contours, and no contour crosses itself.
        let i = 0;
        if (next.length > 1) {
          const turn = ([nx, ny]: [number, number]) => { const ex = nx - x, ey = ny - y; return dx * ey - dy * ex; };
          i = next.findIndex(n => turn(n) > 0);
          if (i < 0) i = 0;
        }
        const [nx, ny] = next.splice(i, 1)[0];
        pts.push([x, y]);
        dx = nx - x; dy = ny - y; x = nx; y = ny;
        if (key(x, y) === start) break;                     // closed
      }
      // one point per corner: drop those inside a straight run
      const n = pts.length, corners: [number, number][] = [];
      for (let j = 0; j < n; j++) {
        const [px, py] = pts[(j + n - 1) % n], [cx, cy] = pts[j], [qx, qy] = pts[(j + 1) % n];
        if ((cx - px) * (qy - cy) - (cy - py) * (qx - cx) !== 0) corners.push([cx - hoff, voff - cy]);
      }
      // traced with the ink on the right as the bitmap lies (rows down): with
      // y up that is clockwise round the ink; PostScript fonts go the other way
      if (corners.length >= 4) contours.push(corners.reverse());
    }
  }
  return contours;
}
