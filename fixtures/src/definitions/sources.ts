/**
 * Public documentation URLs cited by fixture provenance entries.
 *
 * HONESTY RULE (P0-06): only cite documents that really exist. When a deep
 * link is uncertain, cite the program's main documentation site or the FITS
 * standard page instead of inventing a path.
 */
export const SRC = {
  /** FITS 4.0 standard (incl. fixed-format cards and the CONTINUE convention). */
  FITS_STANDARD: 'https://fits.gsfc.nasa.gov/fits_standard.html',
  /** N.I.N.A. documentation (FITS keyword documentation lives under these docs). */
  NINA_DOCS: 'https://nighttime-imaging.eu/docs/master/site/',
  NINA_SITE: 'https://nighttime-imaging.eu/',
  /** Sequence Generator Pro — help: "Data Stored in the FITS Header". */
  SGPRO_SITE: 'https://www.sequencegeneratorpro.com/',
  /** Astro Photography Tool user guide. */
  APT_SITE: 'https://www.astrophotography.app/',
  /** SharpCap user manual. */
  SHARPCAP_SITE: 'https://www.sharpcap.co.uk/',
  /** ZWO (ASIAIR / ASIStudio manuals). */
  ZWO_SITE: 'https://www.zwoastro.com/',
  /** Voyager — Astro Imaging Suite documentation. */
  VOYAGER_SITE: 'https://software.starkeeper.it/',
  /** XISF 1.0 specification. */
  XISF_SPEC: 'https://pixinsight.com/xisf/',
  /** EXIF tag reference. */
  EXIF_TAGS: 'https://exiftool.org/TagNames/EXIF.html',
  /** Community documentation of the Canon CR3 ISO-BMFF container. */
  CR3_STRUCT: 'https://github.com/lclevy/canon_cr3',
} as const;
