# fixtures/

Real-world sample data used by the table-driven unit tests in `packages/core` (see DD-002).

**No fixture data is present yet.** This directory is populated by issue **P0-06**, which adds:

- Real-world **FITS** header samples (NINA, SGP, ASIAIR, Seestar, and other capture software)
- **XISF** header samples (PixInsight)
- **RAW** (EXIF) header samples from DSLR/mirrorless cameras
- A manifest JSON per fixture set describing expected parse output and provenance

Until P0-06 lands, this README is the directory's only content. When adding fixtures later,
every new fixture needs a manifest entry and a provenance note (where the file came from and
what software produced it).
