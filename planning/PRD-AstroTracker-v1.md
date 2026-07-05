# Product Requirements Document: AstroTracker

**Version:** 1.0
**Date:** April 3, 2026
**Author:** Rick Laird / Claude (AI Product Team)
**Status:** Draft - Research & Discovery Phase

---

## 1. Executive Summary

AstroTracker is a desktop application with online integration designed to solve the most persistent pain point in deep-sky astrophotography: organizing, tracking, and retrieving imaging data across years of multi-session capture work. Unlike existing tools that focus narrowly on either capture automation, image processing, or session planning, AstroTracker unifies file management, session statistics, calibration frame tracking, and intelligent target recommendations into a single cohesive platform.

The astrophotography software market is fragmented. Capture tools (N.I.N.A., SGPro, APT) generate files but don't organize them. Processing tools (PixInsight, Siril) consume files but don't track their provenance. Planning tools (Telescopius, Stellarium) suggest targets but have no awareness of what you've already captured. AstroTracker fills the gap between all of these, serving as the central hub for an astrophotographer's entire data lifecycle.

---

## 2. Problem Statement

Deep-sky astrophotographers accumulate terabytes of imaging data over years of work. A single target like M31 (Andromeda Galaxy) might be imaged across dozens of sessions spanning multiple years, using different telescopes, cameras, filters, and exposure settings. The resulting files (FITS, XISF, RAW) are scattered across folders, drives, and sometimes machines with no standard way to:

- **Find all files for a target** when ready to process
- **Calculate total integration time** per target per filter across all sessions
- **Track which calibration frames** (darks, flats, bias) apply to which light frames
- **Know what equipment and settings** were used for each session
- **Link processed final images** back to the original source data
- **Decide what to image tonight** based on what's already been captured and what's optimally positioned

Community forums (Cloudy Nights, Stargazers Lounge, Reddit r/astrophotography) are filled with threads asking "How do you organize your files?" and the answers are consistently: spreadsheets, manual folder naming, and hope. This is the problem AstroTracker solves.

---

## 3. Competitive Analysis

### 3.1 Direct Competitors

#### Observatory (Code Obsession) - Mac Only
- **Platform:** macOS only | **Price:** $79.95 one-time
- **Strengths:** Purpose-built astrophotography library; FITS/XISF metadata reading; smart albums, tags, ratings; plate solving; automatic object identification; non-destructive calibration and stacking; Spotlight/Quick Look plugins
- **Weaknesses:** Mac-only (excludes majority of astrophotographers who use Windows); no explicit integration time tracking across sessions; no web/cloud component; no target planning or suggestions; limited multi-year project aggregation
- **Key Insight:** Observatory is the closest existing product to our vision, but its platform limitation and lack of integration time tracking and target planning leave significant market opportunity.

#### AstroFiler (Open Source)
- **Platform:** Windows, Linux, macOS | **Price:** Free (open source)
- **Strengths:** Cross-platform; intelligent session detection; auto-links calibration frames to light sessions based on camera/binning/temperature; SHA-256 file integrity checking; duplicate detection; full FITS metadata extraction
- **Weaknesses:** Very new (first release 2024, v1.2); tiny community; no planning features; no image processing; limited documentation; no web component
- **Key Insight:** AstroFiler validates market demand for this category. Its intelligent session linking is innovative but the tool is immature.

#### AstroPhotoAssistant
- **Platform:** Windows, macOS | **Price:** $79 one-time
- **Strengths:** Purpose-built for deep-sky project management; per-filter exposure goals; equipment profiles; session logging; portable folder structure export; calibration frame management
- **Weaknesses:** Small community; no FITS metadata auto-reading confirmed; no target suggestions; no integration with planning tools; manual entry required
- **Key Insight:** Validates the project-management angle but misses automation and intelligent recommendations.

### 3.2 Adjacent Tools (Partial Overlap)

| Tool | Category | Platform | Price | File Mgmt | Integration Time | Target Planning |
|------|----------|----------|-------|-----------|-----------------|-----------------|
| **N.I.N.A.** | Capture Automation | Windows | Free | Session logs only | Per-session only | Framing Assistant |
| **Voyager** | Automation | Windows | Subscription | Session data | Via RoboTarget DB | Advanced scheduling |
| **APT** | Capture | Windows | $21 | DataCraft indexing | Per-session | Basic |
| **SGPro** | Sequencing | Windows | Subscription | Profile logging | Per-session | Profile-based |
| **PixInsight** | Processing | Multi | $$$ | Projects (workflow) | None | None |
| **Telescopius** | Planning | Web | Free | None | None | Excellent |
| **AstroBin** | Social/Hosting | Web | Freemium | Image uploads | None | Community-driven |
| **Stellarium** | Planetarium | Multi | Free | None | None | Visibility only |
| **Sky Safari** | Mobile Planetarium | Mobile | Paid | Basic gallery | None | Observation planning |

### 3.3 Critical Market Gap

**No existing tool combines all three capabilities:**

1. File/session management with FITS metadata auto-extraction
2. Integration time accumulation per target across years of sessions
3. Intelligent target suggestions based on what you've already captured, combined with tonight's sky conditions

This is AstroTracker's primary differentiator and competitive moat.

---

## 4. User Personas

### 4.1 Primary Persona: "Deep-Sky Dan" - The Dedicated Backyard Imager

- **Demographics:** 35-60 years old, professional career (engineering, IT, science), disposable income
- **Equipment:** $5,000-$15,000 invested (dedicated astronomy camera, refractor or reflector telescope, equatorial mount, filter wheel with narrowband and broadband filters)
- **Experience:** 2-10 years of deep-sky imaging
- **Data Volume:** 2-10 TB accumulated; 500 GB-2 TB per year
- **Capture Software:** N.I.N.A. or SGPro
- **Processing:** PixInsight or Siril
- **Pain Points:**
    - Has 5+ years of imaging data scattered across drives with no unified catalog
    - Maintains a spreadsheet to track integration time per target but it's always out of date
    - Spends 30+ minutes finding all subs for a target before processing
    - Has duplicate calibration masters and isn't sure which ones are current
    - Doesn't know if tonight's clear sky is better spent on M31 (needs more Ha) or starting a new target
- **Quote:** "I have terabytes of data and no idea what I actually have."
- **Goals:** Spend less time managing files and more time imaging and processing. Know exactly where every frame is and what's needed to complete a target.

### 4.2 Secondary Persona: "Remote Rita" - The Remote Observatory Operator

- **Demographics:** 40-65, often retired or semi-retired, significant investment in the hobby
- **Equipment:** $15,000-$50,000+ (remote observatory, multiple telescopes, automated dome)
- **Experience:** 10+ years; highly technical
- **Data Volume:** 10-50+ TB; runs automated sessions nightly
- **Capture Software:** Voyager or N.I.N.A. with advanced automation
- **Pain Points:**
    - Downloads gigabytes nightly from remote site to local storage
    - Needs to track dozens of active targets across multiple telescopes
    - Calibration frames must be meticulously matched to equipment configurations
    - Wants automated reports on session quality and cumulative progress
- **Quote:** "My observatory captured 200 GB last night. I need to know what's worth keeping."
- **Goals:** Automated ingestion, quality metrics, and project tracking without manual intervention.

### 4.3 Tertiary Persona: "Beginner Ben" - The New Astrophotographer

- **Demographics:** 25-45, curious about astrophotography, learning the craft
- **Equipment:** $500-$2,500 (DSLR or mirrorless, basic tracker or small telescope)
- **Experience:** Less than 2 years; still learning calibration workflow
- **Data Volume:** Less than 500 GB
- **Capture Software:** SharpCap, BackyardEOS, or ASIStudio
- **Pain Points:**
    - Confused about folder organization best practices
    - Doesn't understand when to reuse vs. recapture calibration frames
    - Wants guidance on what to image and how much data is "enough"
    - Overwhelmed by the number of files after just a few sessions
- **Quote:** "I took 200 light frames of Orion last night. Now what?"
- **Goals:** Learn good habits early. Understand what they have and what they need. Get guided recommendations for their next session.

### 4.4 Emerging Persona: "Club Carlos" - The Astronomy Club Coordinator

- **Demographics:** Varies; coordinates imaging sessions for a local club or educational group
- **Equipment:** Shared club equipment or pooled member equipment
- **Pain Points:**
    - Multiple people contribute data from shared sessions
    - Needs to aggregate data from different members' capture setups
    - Wants a shared catalog for club projects
- **Goals:** Collaborative project tracking and data sharing among club members.

---

## 5. Product Vision & Architecture

### 5.1 Architecture Overview

AstroTracker is a **desktop-first application with online integration**:

- **Desktop Application (Core):** Local file scanning, FITS/XISF metadata extraction, library management, session organization, calibration tracking, statistics, and processing workflow management. Works fully offline.
- **Online Service (Enhancement):** Cloud sync of metadata (not image files), target recommendations engine, sky condition integration (weather, moon phase, object altitude), community benchmarks, and cross-device access to statistics and recommendations.

### 5.2 Core Design Principles

1. **Non-destructive:** AstroTracker never moves, renames, or modifies original files unless explicitly asked. It builds an index/catalog overlay.
2. **Metadata-first:** Everything is driven by FITS/XISF header data. Minimal manual entry required.
3. **Flexible organization:** Support target-first, date-first, or equipment-first views regardless of physical folder structure. Virtual organization via metadata.
4. **Offline-capable:** The desktop app must be fully functional without internet. Online features are additive.
5. **Integration-friendly:** Import/export compatibility with N.I.N.A., SGPro, APT, PixInsight, and other tools in the ecosystem.

---

## 6. MVP Feature Set (Version 1.0)

### 6.1 File Discovery & Indexing

- **Watch Folders:** Configure one or more root folders (including external drives) for AstroTracker to scan and monitor
- **FITS/XISF Header Parsing:** Automatically extract OBJECT, FILTER, EXPTIME, DATE-OBS, TELESCOP, INSTRUME, CCD-TEMP, GAIN, OFFSET, IMAGETYP, and other standard keywords
- **RAW Support:** Read EXIF data from Canon CR2/CR3, Nikon NEF, Sony ARW formats
- **File Type Recognition:** Classify files as Light, Dark, Flat, Bias, DarkFlat based on IMAGETYP header or folder naming heuristics
- **Duplicate Detection:** SHA-256 hashing to identify duplicate files across drives
- **Incremental Scanning:** Only process new/changed files on subsequent scans

### 6.2 Target Library

- **Automatic Target Grouping:** Group all files by OBJECT name with fuzzy matching (e.g., "M31", "M 31", "Andromeda Galaxy" all map to the same target)
- **Target Dashboard:** For each target, display:
    - Total integration time (overall and per filter)
    - Number of sessions spanning what date range
    - Equipment used across sessions
    - Thumbnail/preview of best sub or processed image
    - Status indicator (planning / capturing / ready to process / processed / complete)
- **Integration Time Calculator:** Sum EXPTIME across all light frames per target per filter, displayed as hours:minutes
- **Target Search & Filter:** Search by name, filter, equipment, date range, integration time, status

### 6.3 Session Management

- **Automatic Session Detection:** Group files captured on the same night (within a configurable time window, typically dusk-to-dawn)
- **Session Detail View:**
    - Date and time range
    - Target(s) imaged
    - Equipment configuration (telescope, camera, mount)
    - Filter sequence and exposure counts
    - Environmental conditions (if recorded in FITS: temperature, humidity)
    - Quality metrics (average FWHM, star count if available from headers)
- **Session Notes:** Add text notes, weather observations, equipment issues to any session

### 6.4 Calibration Frame Management

- **Calibration Library:** Dedicated section for managing master darks, flats, bias, and dark-flats
- **Smart Matching:** Suggest appropriate calibration frames for a set of lights based on:
    - Camera/sensor match
    - Temperature match (within configurable tolerance, e.g., +/- 2 degrees C)
    - Exposure time match (for darks)
    - Filter match (for flats)
    - Optical train match (for flats)
    - Recency (prefer newer calibration frames)
- **Calibration Status Indicators:** Flag when calibration frames are missing, stale, or mismatched for a session
- **Master Frame Tracking:** Record which raw calibration subs were used to generate each master frame

### 6.5 Processing Workflow Tracking

- **Processing Projects:** Create a processing project that links to source light frames, calibration masters, and intermediate files
- **Processed Image Linking:** Attach final processed images (TIFF, PNG, JPG) to a target with links back to all source data
- **Processing Notes:** Record processing steps, software used, key parameters
- **Version History:** Track multiple processing attempts per target (e.g., "M31 v1 - first attempt", "M31 v2 - added Ha data")

### 6.6 Statistics & Reporting

- **Dashboard:** Overview of total targets, total integration time, sessions per month, most-imaged targets
- **Per-Target Stats:** Detailed breakdown by filter, equipment, and session
- **Equipment Usage:** Track how many hours each telescope, camera, and filter has been used
- **Export:** CSV/JSON export of all statistics for external analysis

### 6.7 Desktop Application

- **Platform:** Windows (primary), macOS (secondary) via Electron or cross-platform framework
- **Performance:** Handle libraries of 100,000+ FITS files without degradation
- **Local Database:** SQLite for metadata catalog; no cloud dependency for core functionality
- **File Browser:** Navigate library by target, date, equipment, or folder structure
- **Thumbnail Generation:** Generate and cache thumbnails for FITS/XISF files

---

## 7. Future Roadmap

### Phase 2: Online Integration & Target Recommendations (v2.0)

- **Cloud Metadata Sync:** Sync library metadata (not files) to cloud for cross-device access
- **Tonight's Sky Panel:** Shows what targets are optimally positioned tonight from your location, with altitude charts and transit times
- **Smart Target Recommendations:**
    - "M31 needs 4 more hours of OIII to match your Ha coverage"
    - "NGC 7000 is at peak altitude tonight and you haven't started it yet"
    - "Your M42 integration is already competitive - consider a new target"
    - Factor in: season/visibility, moon phase, your existing data, filter balance, target difficulty
- **Weather Integration:** Pull forecast data from Clear Outside / Astrospheric to factor into session planning
- **Bortle/Light Pollution Awareness:** Factor in your site's Bortle class for exposure recommendations

### Phase 3: Community & Collaboration (v3.0)

- **Community Benchmarks:** Compare your integration time on a target to community averages ("Most imagers stack 20+ hours on M31 for competition-quality results")
- **Shared Target Lists:** Curated seasonal target lists with recommended exposure plans
- **Club/Team Projects:** Shared projects where multiple members contribute data toward a common target
- **AstroBin Integration:** Link processed images to AstroBin portfolio entries
- **Public Statistics:** Opt-in sharing of anonymized statistics for community analysis

### Phase 4: Advanced Automation (v4.0)

- **Capture Software Integration:** Direct hooks into N.I.N.A., SGPro, Voyager for real-time session logging and automatic file ingestion
- **Auto-Import Pipelines:** Watch folders on remote observatory downloads and auto-catalog
- **Quality Scoring:** Automated sub-frame quality analysis (FWHM, eccentricity, background gradient) with reject/accept recommendations
- **Mosaic Project Support:** Multi-panel mosaic planning and progress tracking
- **Equipment Maintenance Logging:** Track collimation, sensor cleaning, mount PE corrections

### Phase 5: Intelligence & Analytics (v5.0)

- **AI-Powered Suggestions:** Machine learning model trained on your imaging patterns to optimize session planning
- **Predictive Completion:** "At your current pace of 2 hours per clear night, M33 will be complete in approximately 6 sessions"
- **Seasonal Planning Calendar:** Year-long imaging plan optimized for target visibility and your goals
- **Data Quality Trends:** Track improvement in imaging quality over time (star FWHM, background noise trends)

---

## 8. Technical Considerations

### 8.1 File Format Support

| Format | Extensions | Metadata Source | Priority |
|--------|-----------|-----------------|----------|
| FITS | .fits, .fit, .fts | FITS headers | Critical |
| XISF | .xisf | XML properties | Critical |
| Canon RAW | .cr2, .cr3 | EXIF | High |
| Nikon RAW | .nef | EXIF | High |
| Sony RAW | .arw | EXIF | High |
| TIFF | .tif, .tiff | EXIF/TIFF tags | Medium |
| SER | .ser | SER header | Medium |
| PNG/JPG | .png, .jpg | EXIF | Low (finals only) |

### 8.2 Key FITS Keywords to Extract

**Critical (MVP):**
OBJECT, IMAGETYP, FILTER, EXPTIME, DATE-OBS, TELESCOP, INSTRUME, CCD-TEMP, GAIN, OFFSET, XBINNING, YBINNING, NAXIS1, NAXIS2, RA, DEC

**Important (v1.x):**
OBSERVER, SITENAME, AIRMASS, FOCALLEN, APTDIA, PIERSIDE, OBJCTROT, BAYERPAT, ROWORDER, SET-TEMP, SENSORHZ, EGAIN

**Nice to have (v2+):**
FWHM, HFR, STARS, GUIDEERR, HUMIDITY, PRESSURE, WINDSPD, BORESSION

### 8.3 Database Design Principles

- SQLite for local storage (zero-configuration, portable, handles millions of rows)
- Metadata-only database (file paths as references, never store image data in DB)
- Full-text search on target names, notes, and equipment
- Efficient aggregation queries for integration time calculations
- Migration support for schema evolution across versions

### 8.4 Performance Targets

- Scan 10,000 FITS files in under 5 minutes (header-only read)
- Library with 100,000+ files loads in under 3 seconds
- Target dashboard with full statistics renders in under 1 second
- Thumbnail generation: 50 FITS files per second (background thread)

---

## 9. Success Metrics

### 9.1 Adoption Metrics
- 500 active users within 6 months of public launch
- 50 users in closed beta providing regular feedback
- Active community channel (Discord/forum) with daily engagement

### 9.2 Engagement Metrics
- Average user catalogs 1,000+ files within first week
- 70% of users return weekly during imaging season
- 80% of users configure at least one watch folder
- 50% of users create processing project links

### 9.3 Value Metrics
- Users report 75% reduction in time finding files for processing
- Average "time to first stack" (finding all subs for a target) drops from 30+ minutes to under 2 minutes
- 90% of users say they'd recommend AstroTracker to other astrophotographers

---

## 10. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| FITS header inconsistency across capture software | Files miscategorized or missing metadata | High | Heuristic fallback to folder naming; manual override; community-maintained software profiles |
| Performance with very large libraries (50K+ files) | Slow scanning and queries | Medium | Background indexing; incremental scans; database query optimization; pagination |
| User adoption in niche market | Insufficient user base for sustainability | Medium | Freemium model; open API; community engagement; solve a painful problem extremely well |
| AstroFiler gains traction as free alternative | Competitive pressure on paid features | Medium | Differentiate on UX, integration time tracking, and target recommendations (our unique features) |
| Cloud service reliability for recommendations | Users frustrated when offline | Low | Core functionality fully offline; online features gracefully degrade |
| File system permission issues on Windows/macOS | Can't scan user's folders | Medium | Clear onboarding; minimal permissions required (read-only for indexing) |

---

## 11. Monetization Strategy

### Recommended: Freemium Model

**Free Tier (Desktop Core):**
- File scanning and indexing (up to 10,000 files)
- Target library with integration time tracking
- Session management
- Basic calibration matching
- Statistics dashboard

**Pro Tier ($59/year or $7/month):**
- Unlimited file indexing
- Smart target recommendations (online)
- Cloud metadata sync
- Advanced calibration management
- Processing project tracking
- Priority support

**Team Tier ($149/year):**
- Everything in Pro
- Club/team shared projects
- Multi-user metadata sharing
- API access

### Pricing Rationale
The astrophotography community already spends $21 (APT) to $80 (Observatory, AstroPhotoAssistant) on one-time licenses and $5-20/month on subscriptions (Adobe, cloud backup). A $59/year subscription is well within the demonstrated willingness to pay, especially for users who've invested $5,000-$50,000 in equipment.

---

## 12. Research Sources

### Competitor Websites
- [Observatory - Code Obsession](https://codeobsession.com/)
- [AstroFiler](https://www.astrofiler.com/) | [GitHub](https://github.com/gordtulloch/astrofiler-gui)
- [AstroPhotoAssistant](https://astrophotoassistant.com/)
- [N.I.N.A.](https://nighttime-imaging.eu/)
- [Voyager - Starkeeper](https://software.starkeeper.it/)
- [APT - AstroPhotography Tool](http://www.astrophotography.app)
- [Sequence Generator Pro](https://www.sequencegeneratorpro.com/)
- [PixInsight](https://pixinsight.com/)
- [AstroPlanner](https://www.astroplanner.net/)
- [AstroArt](https://www.msb-astroart.com/)

### Planning & Recommendation Tools
- [Telescopius](https://telescopius.com/)
- [AstroBin](https://astrobin.com/)
- [Stellarium](https://stellarium.org/)
- [SkySafari](https://skysafariastronomy.com/)
- [Clear Outside](https://clearoutside.com/)
- [Astrospheric](https://www.astrospheric.com/)
- [Light Pollution Map](https://www.lightpollutionmap.info/)
- [AstroMosaic](https://ruuth.xyz/AstroMosaicInfo.html)
- [DeepSkyCentral](https://www.deepskycentral.com/)
- [Nova DSO Tracker (GitHub)](https://github.com/mrantonSG/nova_DSO_tracker)

### Community Research
- [Cloudy Nights Forums](https://www.cloudynights.com/) - file organization, session management threads
- [Stargazers Lounge](https://stargazerslounge.com/) - data storage, calibration management discussions
- [Reddit r/astrophotography](https://reddit.com/r/astrophotography)
- [Astro Backyard](https://astrobackyard.com/) - software reviews and resources
- [MAC Observatory](https://macobservatory.com/) - astrophotography data organization guides
- [AstronoMolly](http://www.astronomolly.com/2021/03/how-i-organize-my-data.html) - data organization blog

### Technical References
- [FITS File Header Definitions (MaxIm DL)](https://cdn.diffractionlimited.com/help/maximdl/FITS_File_Header_Definitions.htm)
- [N.I.N.A. FITS Format Documentation](https://nighttime-imaging.eu/docs/master/site/advanced/file_formats/fits/)
- [XISF Format Specification (PixInsight)](https://pixinsight.com/xisf/)
- [Sky & Telescope - FITS Format Guide](https://skyandtelescope.org/astronomy-blogs/imaging-foundations-richard-wright/astro-imaging-fits-format/)

---

*Document generated April 3, 2026. This is a living document and will be updated as research continues and stakeholder feedback is incorporated.*
