#!/usr/bin/env node
/**
 * Issue/breakdown drift guard.
 *
 * `CLAUDE.md` makes `planning/task-breakdown.md` authoritative for every
 * GitHub issue, but nothing enforced that. The breakdown was revised to cut
 * and insert scope while the tracker was not regenerated, so from one issue
 * onward every task ID pointed at the wrong work and two tasks had no issue
 * at all. An agent following CLAUDE.md would read one task and implement
 * another.
 *
 * This script re-checks that invariant. It parses every `### <ID>: <title>`
 * heading from the breakdown, lists open issues titled `[<ID>] <title>` via
 * `gh`, and reports four failure classes:
 *
 *   - duplicate ID in the breakdown (the `P1-35` collision that started this)
 *   - duplicate ID across open issues
 *   - a breakdown task with no open issue (untracked work)
 *   - an issue whose title text disagrees with the breakdown (silent drift)
 *
 * Closed issues are treated as done, not missing, so completed phases do not
 * produce noise. Only phases that have actually been bootstrapped into the
 * tracker are checked (see TRACKED_PHASES) — Phase 2+ lives in the breakdown
 * as forward plan and deliberately has no issues yet, so checking it would
 * bury real drift under dozens of expected misses. Widen TRACKED_PHASES when
 * a later phase is bootstrapped.
 *
 * Exits non-zero when anything is reported.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BREAKDOWN = path.join(repoRoot, 'planning', 'task-breakdown.md');

/**
 * Task-ID prefixes that have been bootstrapped into GitHub. Phase 0 and 1
 * (including the Phase 1.x `P1x-*` tasks, which are filed so v1.0 scope cuts
 * have somewhere to land) are tracked; Phase 2-5 are plan-only for now.
 */
const TRACKED_PHASES = ['P0-', 'P1-', 'P1x-'];

/** True when `id` belongs to a phase that should have issues filed. */
function isTracked(id) {
  return TRACKED_PHASES.some((prefix) => id.startsWith(prefix));
}

/** `### P1-20: Calibration gap detection` -> { id: 'P1-20', title: '...' }. */
const HEADING = /^###\s+(P\d+x?-\d+[a-z]?):\s*(.+?)\s*$/;
/** `[P1-20] Calibration gap detection` -> { id, title }. */
const ISSUE_TITLE = /^\[(P\d+x?-\d+[a-z]?)\]\s*(.+?)\s*$/;

function parseBreakdown() {
  const tasks = new Map();
  const duplicates = [];
  const lines = readFileSync(BREAKDOWN, 'utf8').split('\n');
  lines.forEach((line, index) => {
    const match = HEADING.exec(line);
    if (match === null) return;
    const [, id, title] = match;
    if (!isTracked(id)) return;
    if (tasks.has(id)) {
      duplicates.push(`${id} at lines ${tasks.get(id).line} and ${index + 1}`);
      return;
    }
    tasks.set(id, { title, line: index + 1 });
  });
  return { tasks, duplicates };
}

function listIssues() {
  const raw = execFileSync(
    'gh',
    ['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,title,state'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const open = new Map();
  const closed = new Set();
  const duplicates = [];
  for (const issue of JSON.parse(raw)) {
    const match = ISSUE_TITLE.exec(issue.title);
    if (match === null) continue;
    const [, id, title] = match;
    if (!isTracked(id)) continue;
    if (issue.state !== 'OPEN') {
      closed.add(id);
      continue;
    }
    if (open.has(id)) {
      duplicates.push(`${id} on #${open.get(id).number} and #${issue.number}`);
      continue;
    }
    open.set(id, { number: issue.number, title });
  }
  return { open, closed, duplicates };
}

/** Titles are compared on normalized whitespace and dash style only. */
function normalize(title) {
  return title.replace(/[—–-]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
}

const problems = [];
const { tasks, duplicates: breakdownDupes } = parseBreakdown();
const { open, closed, duplicates: issueDupes } = listIssues();

for (const entry of breakdownDupes) {
  problems.push(`duplicate task ID in task-breakdown.md: ${entry}`);
}
for (const entry of issueDupes) {
  problems.push(`duplicate task ID across open issues: ${entry}`);
}
for (const [id, task] of tasks) {
  const issue = open.get(id);
  if (issue === undefined) {
    if (!closed.has(id)) {
      problems.push(`${id} has no issue (task-breakdown.md line ${task.line}): ${task.title}`);
    }
    continue;
  }
  if (normalize(issue.title) !== normalize(task.title)) {
    problems.push(
      `${id} title drift on #${issue.number}\n    issue:     ${issue.title}\n    breakdown: ${task.title}`,
    );
  }
}
for (const [id, issue] of open) {
  if (!tasks.has(id)) {
    problems.push(`#${issue.number} claims ${id}, which task-breakdown.md does not define`);
  }
}

if (problems.length > 0) {
  console.error(`Issue/breakdown drift detected (${problems.length}):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nplanning/task-breakdown.md is authoritative (CLAUDE.md). Fix the tracker.');
  process.exit(1);
}
console.log(
  `In sync across ${TRACKED_PHASES.join(', ')}: ` +
    `${tasks.size} tasks, ${open.size} open issues, ${closed.size} closed.`,
);
