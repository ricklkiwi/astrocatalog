/**
 * RAW EXIF sample fixtures (6): CR2/NEF/ARW (TIFF-based) + CR3 (ISO-BMFF),
 * plus 2 malformed samples.
 *
 * Header conventions synthesized from the TIFF 6.0 / Exif tag registry
 * (https://exiftool.org/TagNames/EXIF.html) and the community CR3
 * reverse-engineering write-up (https://github.com/lclevy/canon_cr3). No
 * sensor data is written — metadata only. OBJECT/FILTER are null for every
 * entry: EXIF has no such fields (P1-03 hands those to path heuristics).
 */

import { buildCr3, buildTiff, truncate, type TiffEntry } from '../lib/tiff-exif.js';
import { FIXTURE_DATE, LICENSE } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const SOURCES = [SRC.EXIF_TAGS];

// Exif tag numbers (TIFF 6.0 / Exif 2.3 registry).
const MAKE = 271;
const MODEL = 272;
const EXPOSURE_TIME = 0x829a;
const ISO_SPEED_RATINGS = 0x8827;
const DATE_TIME_ORIGINAL = 0x9003;
const OFFSET_TIME_ORIGINAL = 0x9011;

function camera(make: string, model: string): TiffEntry[] {
  return [
    { tag: MAKE, type: 'ASCII', value: make },
    { tag: MODEL, type: 'ASCII', value: model },
  ];
}

export const rawDefs: FixtureDef[] = [
  // --- Valid: CR2 (Canon), with-offset sample --------------------------------
  (() => {
    const bytes = buildTiff({
      ifd0: camera('Canon', 'Canon EOS 6D'),
      exifIfd: [
        { tag: EXPOSURE_TIME, type: 'RATIONAL', value: [1, 200] },
        { tag: ISO_SPEED_RATINGS, type: 'SHORT', value: 800 },
        { tag: DATE_TIME_ORIGINAL, type: 'ASCII', value: '2026:04:05 22:11:03' },
        { tag: OFFSET_TIME_ORIGINAL, type: 'ASCII', value: '+02:00' },
      ],
    });
    return {
      build: () => bytes,
      entry: {
        file: 'raw/canon-6d-light.cr2',
        format: 'raw',
        description:
          'Minimal-valid Canon CR2 (TIFF-based) sample with IFD0 Make/Model and an EXIF ' +
          'sub-IFD carrying ExposureTime/ISOSpeedRatings/DateTimeOriginal plus ' +
          'OffsetTimeOriginal (the with-offset case in this 3-sample trio).',
        provenance: {
          method: 'synthesized-to-conventions',
          program: 'Canon EOS (CR2)',
          sources: SOURCES,
          license: LICENSE,
          date: FIXTURE_DATE,
        },
        expected: {
          status: 'ok',
          keywords: {
            OBJECT: null,
            FILTER: null,
            Make: 'Canon',
            Model: 'Canon EOS 6D',
            ExposureTime: 0.005,
            ISO: 800,
            DateTimeOriginal: '2026:04:05 22:11:03',
            OffsetTimeOriginal: '+02:00',
          },
          notes:
            "Verified by this package's structural test: exifr.parse() returns ExposureTime, " +
            'ISO, DateTimeOriginal, and OffsetTimeOriginal matching these values exactly.',
        },
      },
    } satisfies FixtureDef;
  })(),

  // --- Valid: NEF (Nikon), no offset -----------------------------------------
  (() => {
    const bytes = buildTiff({
      ifd0: camera('NIKON CORPORATION', 'NIKON Z 6'),
      exifIfd: [
        { tag: EXPOSURE_TIME, type: 'RATIONAL', value: [1, 400] },
        { tag: ISO_SPEED_RATINGS, type: 'SHORT', value: 1600 },
        { tag: DATE_TIME_ORIGINAL, type: 'ASCII', value: '2026:04:06 01:20:00' },
      ],
    });
    return {
      build: () => bytes,
      entry: {
        file: 'raw/nikon-z6-light.nef',
        format: 'raw',
        description:
          'Minimal-valid Nikon NEF (plain TIFF) sample: no OffsetTimeOriginal (the ' +
          'without-offset case).',
        provenance: {
          method: 'synthesized-to-conventions',
          program: 'Nikon (NEF)',
          sources: SOURCES,
          license: LICENSE,
          date: FIXTURE_DATE,
        },
        expected: {
          status: 'ok',
          keywords: {
            OBJECT: null,
            FILTER: null,
            Make: 'NIKON CORPORATION',
            Model: 'NIKON Z 6',
            ExposureTime: 0.0025,
            ISO: 1600,
            DateTimeOriginal: '2026:04:06 01:20:00',
            OffsetTimeOriginal: null,
          },
          notes: 'OffsetTimeOriginal is structurally absent — no tag 0x9011 in the EXIF IFD.',
        },
      },
    } satisfies FixtureDef;
  })(),

  // --- Valid: ARW (Sony), no offset -------------------------------------------
  (() => {
    const bytes = buildTiff({
      ifd0: camera('SONY', 'ILCE-7M4'),
      exifIfd: [
        { tag: EXPOSURE_TIME, type: 'RATIONAL', value: [1, 125] },
        { tag: ISO_SPEED_RATINGS, type: 'SHORT', value: 400 },
        { tag: DATE_TIME_ORIGINAL, type: 'ASCII', value: '2026:04:07 03:45:12' },
      ],
    });
    return {
      build: () => bytes,
      entry: {
        file: 'raw/sony-a7iv-light.arw',
        format: 'raw',
        description: 'Minimal-valid Sony ARW (plain TIFF) sample, no OffsetTimeOriginal.',
        provenance: {
          method: 'synthesized-to-conventions',
          program: 'Sony (ARW)',
          sources: SOURCES,
          license: LICENSE,
          date: FIXTURE_DATE,
        },
        expected: {
          status: 'ok',
          keywords: {
            OBJECT: null,
            FILTER: null,
            Make: 'SONY',
            Model: 'ILCE-7M4',
            ExposureTime: 0.008,
            ISO: 400,
            DateTimeOriginal: '2026:04:07 03:45:12',
            OffsetTimeOriginal: null,
          },
        },
      },
    } satisfies FixtureDef;
  })(),

  // --- Valid (best-effort): CR3 -----------------------------------------------
  (() => {
    const inner = buildTiff({
      ifd0: camera('Canon', 'Canon EOS R6'),
      exifIfd: [
        { tag: EXPOSURE_TIME, type: 'RATIONAL', value: [1, 250] },
        { tag: ISO_SPEED_RATINGS, type: 'SHORT', value: 3200 },
        { tag: DATE_TIME_ORIGINAL, type: 'ASCII', value: '2026:04:08 04:02:00' },
      ],
    });
    const bytes = buildCr3({ cmt1: inner, cmt2: inner });
    return {
      build: () => bytes,
      entry: {
        file: 'raw/canon-r6-light.cr3',
        format: 'raw',
        description:
          'Best-effort minimal Canon CR3 (ISO-BMFF): ftyp + moov (Canon-style uuid metadata ' +
          'box with a CTBO offset table) + appended CMT1/CMT2 TIFF/EXIF blocks, structured ' +
          'per the community CR3 write-up.',
        provenance: {
          method: 'synthesized-to-conventions',
          program: 'Canon EOS (CR3)',
          sources: [SRC.CR3_STRUCT, SRC.EXIF_TAGS],
          license: LICENSE,
          date: FIXTURE_DATE,
        },
        expected: {
          status: 'ok',
          keywords: {
            OBJECT: null,
            FILTER: null,
            Make: 'Canon',
            Model: 'Canon EOS R6',
            ExposureTime: 0.004,
            ISO: 3200,
            DateTimeOriginal: '2026:04:08 04:02:00',
            OffsetTimeOriginal: null,
          },
          notes:
            "exifr limitation (verified in this package's own structural test): exifr's CR3 " +
            'reader expects the exact box/offset layout Canon firmware produces and returns ' +
            "'Unknown file format' for this hand-built approximation. The embedded CMT1/CMT2 " +
            'blocks are themselves valid, exifr-parseable TIFF/EXIF (see raw/canon-6d-light.cr2 ' +
            'for proof the same builder round-trips). The fixture is kept — not silently ' +
            'dropped — per the P0-06 plan; P1-03 planning should treat CR3 support as needing ' +
            'either a dedicated box-offset reader or a real camera-captured sample.',
        },
      },
    } satisfies FixtureDef;
  })(),

  // --- Malformed: truncated TIFF header ---------------------------------------
  (() => {
    const full = buildTiff({
      ifd0: camera('Canon', 'Canon EOS 6D'),
      exifIfd: [{ tag: EXPOSURE_TIME, type: 'RATIONAL', value: [1, 200] }],
    });
    const bytes = truncate(full, 10);
    return {
      build: () => bytes,
      entry: {
        file: 'raw/malformed-truncated.cr2',
        format: 'raw',
        description:
          'TIFF header truncated to 10 bytes — the IFD0 entry table never fully appears.',
        provenance: {
          method: 'synthesized-to-conventions',
          sources: SOURCES,
          license: LICENSE,
          date: FIXTURE_DATE,
        },
        expected: {
          status: 'error',
          errorCode: 'TRUNCATED_HEADER',
          notes: 'Only the 8-byte TIFF header plus 2 bytes of the IFD0 entry count are present.',
        },
      },
    } satisfies FixtureDef;
  })(),

  // --- Malformed: garbage bytes with a correct extension -----------------------
  {
    build: () => {
      const bytes = new Uint8Array(64);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
      return bytes;
    },
    entry: {
      file: 'raw/malformed-garbage.nef',
      format: 'raw',
      description: 'Correctly-extensioned .nef file containing 64 bytes of non-TIFF garbage.',
      provenance: {
        method: 'synthesized-to-conventions',
        sources: SOURCES,
        license: LICENSE,
        date: FIXTURE_DATE,
      },
      expected: {
        status: 'error',
        errorCode: 'UNRECOGNIZED_RAW',
        notes: 'First two bytes are not a valid TIFF byte-order marker (neither "II" nor "MM").',
      },
    },
  },
];
