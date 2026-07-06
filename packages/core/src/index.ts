/**
 * Placeholder export proving the `core` package builds, lints, and tests
 * under the shared toolchain. Real domain logic (parsers, catalog) lands in Phase 1.
 */
export const coreVersion = '0.1.0';

/** Returns a human-readable identifier for this package. */
export function describeCore(): string {
  return `core@${coreVersion}`;
}
