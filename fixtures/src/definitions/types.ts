/** Shared manifest/definition types. Mirrors fixtures/manifest.schema.json. */

export type JsonScalar = string | number | boolean | null;

export type ProvenanceMethod = 'synthesized-to-conventions' | 'user-captured' | 'cc0-import';

export type ErrorCode =
  | 'TRUNCATED_HEADER'
  | 'MISSING_END'
  | 'INVALID_CARD'
  | 'BAD_CONTINUE'
  | 'NOT_FITS'
  | 'EMPTY_FILE'
  | 'MALFORMED_XML'
  | 'BAD_SIGNATURE'
  | 'UNRECOGNIZED_RAW';

export interface Provenance {
  method: ProvenanceMethod;
  program?: string;
  emulatesVersion?: string;
  sources: string[];
  license: string;
  date: string;
}

export interface ExpectedOk {
  status: 'ok';
  keywords: Record<string, JsonScalar>;
  cardCount?: number;
  headerBytes?: number;
  notes?: string;
}

export interface ExpectedError {
  status: 'error';
  errorCode: ErrorCode;
  notes?: string;
}

export type FixtureFormat = 'fits' | 'xisf' | 'raw';

export interface ManifestEntry {
  file: string;
  format: FixtureFormat;
  description: string;
  provenance: Provenance;
  expected: ExpectedOk | ExpectedError;
}

export interface FixtureDef {
  entry: ManifestEntry;
  build: () => Uint8Array;
}
