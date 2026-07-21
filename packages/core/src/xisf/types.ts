/**
 * Types for the header-only XISF parser (P1-02, DD-004).
 *
 * Pure domain types: no Electron, no fs (DD-002 rule 1). The parser reads
 * through a caller-supplied {@link XisfReader}, so all I/O stays outside
 * `packages/core`.
 */

/** One `<Property id="..." type="..." value="..."/>` element. Value stays a string — XISF property typing is out of scope for P1-02. */
export interface XisfProperty {
  type: string;
  value: string;
}

/**
 * Structured error codes drawn from `fixtures/manifest.schema.json`'s closed
 * enum (the XISF subset). The parser returns these — it never throws on
 * malformed input (DD-004 error isolation).
 */
export type XisfErrorCode = 'EMPTY_FILE' | 'BAD_SIGNATURE' | 'TRUNCATED_HEADER' | 'MALFORMED_XML';

export interface XisfParseError {
  code: XisfErrorCode;
  message: string;
}

/** Successful header parse: FITSKeyword compatibility map plus native Property map. */
export interface XisfHeader {
  /**
   * `<FITSKeyword name="..." value="..."/>` elements, keyed by name. Values
   * are always strings (XML attributes) — unlike {@link FitsValue}, XISF
   * carries no type information at this layer; numeric coercion happens in
   * `toFrameMetadata`.
   */
  keywords: Record<string, string>;
  /** `<Property id="..." .../>` elements, keyed by id (e.g. `Observation:Object:Name`). */
  properties: Record<string, XisfProperty>;
  /** Total header-region size in bytes: 16-byte signature block + the declared XML length. */
  headerBytes: number;
}

export type XisfParseResult =
  { status: 'ok'; header: XisfHeader } | { status: 'error'; error: XisfParseError };

/**
 * Bounded random-access read callback (DD-002: parsers accept readers, never
 * touch fs). Returns up to `length` bytes starting at `offset`; returning
 * fewer bytes (or none) signals end of file. The parser only ever requests
 * the 16-byte signature block and then the declared XML header region — it
 * never reads into the pixel payload.
 */
export type XisfReader = (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;
