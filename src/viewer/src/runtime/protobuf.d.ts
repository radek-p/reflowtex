// SPDX-License-Identifier: AGPL-3.0-or-later
// protobuf.js, as the page loads it: the vendored src/viewer/protobuf.min.js,
// a classic script that defines the global `protobuf` before the viewer runs.
// Its types are the npm package's (the same major version).
import type * as protobufjs from 'protobufjs';

declare global {
    const protobuf: typeof protobufjs;
}
