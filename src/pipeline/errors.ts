// SPDX-License-Identifier: AGPL-3.0-or-later
// What can go wrong in a build, as errors a caller can tell apart: an
// integration may stop the whole build (CI) or show a block's error in its
// place (a preview). `block` names the block, as the caller knows it.

export class BuildError extends Error {
  block?: string;
  constructor(message: string, block?: string) {
    super(block ? `${block}: ${message}` : message);
    this.name = new.target.name;
    this.block = block;
  }
}

/** LuaTeX failed, or reported an error it carried on past (nonstopmode): the
 *  node list would be a repaired document, not the one written. */
export class TexError extends BuildError {}
/** A picture could not be converted (a missing file, an unsupported format,
 *  Ghostscript or dvisvgm failing). */
export class PictureError extends BuildError {}
/** A font could not be provisioned, patched or verified. */
export class FontError extends BuildError {}
/** The data does not fit latex.proto: an untransformed node type, or a
 *  schema behind the serializer. */
export class SchemaMismatch extends BuildError {}
