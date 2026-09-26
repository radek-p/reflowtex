// SPDX-License-Identifier: AGPL-3.0-or-later
// The wire format's schema, src/schema/latex.proto, loaded at run time by
// protobufjs – the same file the browser loads – so there is no generated
// code to keep in step with it (and no protoc).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import protobuf from 'protobufjs';

export const PROTO_PATH = fileURLToPath(new URL('../schema/latex.proto', import.meta.url));

let root: protobuf.Root | null = null;

/** The parsed schema. `keepCase`: the schema's field names are snake_case and
 *  so are the pipeline's keys; without it protobufjs would camelCase every
 *  field, and fromObject would silently drop each snake_case key. */
export function schema(): protobuf.Root {
  root ??= new protobuf.Root().loadSync(PROTO_PATH, { keepCase: true });
  return root;
}

export const messageType = (name: string): protobuf.Type => schema().lookupType(`latex.${name}`);

/** The .proto text, for a page to embed once (the viewer parses it). */
export const protoText = (): string => readFileSync(PROTO_PATH, 'utf8');
