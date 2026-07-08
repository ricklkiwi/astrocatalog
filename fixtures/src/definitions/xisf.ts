/**
 * XISF sample fixtures (5): 3 valid + 2 malformed.
 *
 * Header conventions synthesized from the XISF 1.0 specification
 * (https://pixinsight.com/xisf/). Keyword names in `expected.keywords` use
 * the same normalized names as the FITS manifests (OBJECT, EXPTIME, ...) so
 * P1-01/P1-02 share one FrameMetadata shape (spec criterion).
 */

import { buildBadSignature, buildMalformedXml, buildXisf } from '../lib/xisf.js';
import { FIXTURE_DATE, LICENSE } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const SOURCES = [SRC.XISF_SPEC];

export const xisfDefs: FixtureDef[] = [
  {
    build: () =>
      buildXisf({
        imageGeometry: '4656:3520:1',
        sampleFormat: 'UInt16',
        colorSpace: 'Gray',
        attachmentLocation: 'attachment:16416:32800000',
        fitsKeywords: [
          { name: 'OBJECT', value: 'M 31', comment: 'Target name' },
          { name: 'IMAGETYP', value: 'LIGHT', comment: 'Type of exposure' },
          { name: 'FILTER', value: 'Ha 3nm', comment: 'Active filter name' },
          { name: 'EXPTIME', value: '300', comment: '[s] Exposure duration' },
          {
            name: 'DATE-OBS',
            value: '2026-01-15T03:22:10.123',
            comment: 'Time of observation (UTC)',
          },
          { name: 'TELESCOP', value: 'Sky-Watcher Esprit 100ED', comment: 'Telescope name' },
          { name: 'INSTRUME', value: 'ZWO ASI2600MM Pro', comment: 'Imaging instrument name' },
          { name: 'CCD-TEMP', value: '-10.1', comment: '[degC] CCD temperature' },
          { name: 'GAIN', value: '100', comment: 'Sensor gain' },
          { name: 'OFFSET', value: '50', comment: 'Sensor gain offset' },
          { name: 'XBINNING', value: '1', comment: 'X axis binning factor' },
          { name: 'YBINNING', value: '1', comment: 'Y axis binning factor' },
          { name: 'NAXIS1', value: '4656', comment: 'length of data axis 1' },
          { name: 'NAXIS2', value: '3520', comment: 'length of data axis 2' },
          { name: 'RA', value: '10.684708', comment: '[deg] RA of telescope' },
          { name: 'DEC', value: '41.26875', comment: '[deg] Declination of telescope' },
        ],
        properties: [
          { id: 'Observation:Object:Name', type: 'String', value: 'M 31' },
          { id: 'Observation:Time:Start', type: 'TimePoint', value: '2026-01-15T03:22:10.123' },
          { id: 'Instrument:ExposureTime', type: 'Float32', value: '300' },
          { id: 'Instrument:Filter:Name', type: 'String', value: 'Ha 3nm' },
          { id: 'Instrument:Telescope:Name', type: 'String', value: 'Sky-Watcher Esprit 100ED' },
          { id: 'Instrument:Sensor:Temperature', type: 'Float32', value: '-10.1' },
        ],
      }),
    entry: {
      file: 'xisf/pixinsight-unit-mono-ha.xisf',
      format: 'xisf',
      description:
        'PixInsight-style monolithic XISF unit: Image element carries both FITSKeyword ' +
        'elements (for FITS compatibility) and native XISF Property elements ' +
        '(Observation:Object:Name, Instrument:ExposureTime, ...), mirroring the N.I.N.A. ' +
        'mono narrowband light fixture.',
      provenance: {
        method: 'synthesized-to-conventions',
        program: 'PixInsight',
        emulatesVersion: '1.8.x (XISF 1.0)',
        sources: SOURCES,
        license: LICENSE,
        date: FIXTURE_DATE,
      },
      expected: {
        status: 'ok',
        keywords: {
          OBJECT: 'M 31',
          IMAGETYP: 'LIGHT',
          FILTER: 'Ha 3nm',
          EXPTIME: '300',
          'DATE-OBS': '2026-01-15T03:22:10.123',
          TELESCOP: 'Sky-Watcher Esprit 100ED',
          INSTRUME: 'ZWO ASI2600MM Pro',
          'CCD-TEMP': '-10.1',
          GAIN: '100',
          OFFSET: '50',
          XBINNING: '1',
          YBINNING: '1',
          NAXIS1: '4656',
          NAXIS2: '3520',
          RA: '10.684708',
          DEC: '41.26875',
        },
        notes:
          'FITSKeyword values are XML attribute strings (unlike FITS typed cards); P1-02 ' +
          'decides numeric coercion. Property elements carry the native XISF namespace ' +
          '(Observation:*/Instrument:*) alongside the FITSKeyword compatibility set.',
      },
    },
  },

  {
    build: () =>
      buildXisf({
        imageGeometry: '4656:3520:1',
        sampleFormat: 'UInt16',
        colorSpace: 'Gray',
        attachmentLocation: 'attachment:16416:32800000',
        fitsKeywords: [
          { name: 'OBJECT', value: 'M 42', comment: 'Name of the object of interest' },
          { name: 'IMAGETYP', value: 'LIGHT', comment: 'Type of exposure' },
          { name: 'FILTER', value: 'OIII', comment: 'Active filter name' },
          { name: 'EXPOSURE', value: '300', comment: '[s] Exposure duration' },
          { name: 'EXPTIME', value: '300', comment: '[s] Exposure duration' },
          {
            name: 'DATE-LOC',
            value: '2026-02-01T20:00:00.000',
            comment: 'Time of observation (local)',
          },
          {
            name: 'DATE-OBS',
            value: '2026-02-02T01:00:00.000',
            comment: 'Time of observation (UTC)',
          },
          { name: 'TELESCOP', value: 'Sky-Watcher Esprit 100ED', comment: 'Name of telescope' },
          { name: 'INSTRUME', value: 'ZWO ASI2600MM Pro', comment: 'Imaging instrument name' },
          { name: 'GAIN', value: '100', comment: 'Sensor gain' },
          { name: 'OFFSET', value: '50', comment: 'Sensor gain offset' },
          { name: 'RA', value: '83.822083', comment: '[deg] RA of telescope' },
          { name: 'DEC', value: '-5.391111', comment: '[deg] Declination of telescope' },
        ],
      }),
    entry: {
      file: 'xisf/nina-unit-mono-oiii.xisf',
      format: 'xisf',
      description:
        'N.I.N.A.-written-style XISF unit: the FITSKeyword set N.I.N.A. documents for XISF ' +
        'output (EXPOSURE+EXPTIME, DATE-LOC+DATE-OBS pair), no XISF-native Property elements.',
      provenance: {
        method: 'synthesized-to-conventions',
        program: 'N.I.N.A.',
        emulatesVersion: '3.x (XISF output)',
        sources: [SRC.NINA_DOCS, SRC.XISF_SPEC],
        license: LICENSE,
        date: FIXTURE_DATE,
      },
      expected: {
        status: 'ok',
        keywords: {
          OBJECT: 'M 42',
          IMAGETYP: 'LIGHT',
          FILTER: 'OIII',
          EXPOSURE: '300',
          EXPTIME: '300',
          'DATE-OBS': '2026-02-02T01:00:00.000',
          'DATE-LOC': '2026-02-01T20:00:00.000',
          TELESCOP: 'Sky-Watcher Esprit 100ED',
          INSTRUME: 'ZWO ASI2600MM Pro',
          GAIN: '100',
          OFFSET: '50',
          RA: '83.822083',
          DEC: '-5.391111',
        },
        notes:
          'DATE-LOC deliberately differs from DATE-OBS (same negative control as the FITS set).',
      },
    },
  },

  {
    build: () =>
      buildXisf({
        imageGeometry: '256:256:1',
        sampleFormat: 'UInt16',
        colorSpace: 'Gray',
        attachmentLocation: 'attachment:16416:131072',
      }),
    entry: {
      file: 'xisf/minimal-unit.xisf',
      format: 'xisf',
      description:
        'Minimal valid XISF unit: signature + XML header with only the Image element, no keywords.',
      provenance: {
        method: 'synthesized-to-conventions',
        sources: SOURCES,
        license: LICENSE,
        date: FIXTURE_DATE,
      },
      expected: {
        status: 'ok',
        keywords: {},
        notes: 'No FITSKeyword or Property elements at all - the structural floor of a valid unit.',
      },
    },
  },

  {
    build: () => buildMalformedXml(),
    entry: {
      file: 'xisf/malformed-unclosed-tag.xisf',
      format: 'xisf',
      description:
        'Well-formed 16-byte signature block, but the XML body has an unclosed <Image> tag.',
      provenance: {
        method: 'synthesized-to-conventions',
        sources: SOURCES,
        license: LICENSE,
        date: FIXTURE_DATE,
      },
      expected: {
        status: 'error',
        errorCode: 'MALFORMED_XML',
        notes:
          'Signature and declared header length are both valid; the XML fails well-' +
          'formedness. Parser must return the structured error, never throw.',
      },
    },
  },

  {
    build: () =>
      buildBadSignature({
        imageGeometry: '256:256:1',
        sampleFormat: 'UInt16',
        colorSpace: 'Gray',
        attachmentLocation: 'attachment:16416:131072',
      }),
    entry: {
      file: 'xisf/malformed-wrong-signature.xisf',
      format: 'xisf',
      description:
        "First 8 bytes are not 'XISF0100' (the XML body behind it is otherwise well-formed).",
      provenance: {
        method: 'synthesized-to-conventions',
        sources: SOURCES,
        license: LICENSE,
        date: FIXTURE_DATE,
      },
      expected: {
        status: 'error',
        errorCode: 'BAD_SIGNATURE',
        notes: 'Parser must check the signature before trusting the header length or XML at all.',
      },
    },
  },
];
