#!/usr/bin/env python3
"""
AstroTracker GitHub bootstrap.

Reads GITHUB_TOKEN (and optional GITHUB_REPO) from .env in the repository root,
then:
  1. pushes the contents of this repository as the initial commit to the GitHub repo
  2. creates issue labels
  3. creates Phase 0 + Phase 1 issues (42) from issues-phase-0-1.json
  4. rewrites "Depends on" task IDs into real #issue links

The token never leaves this machine. Idempotent: re-running skips
existing labels/issues and only pushes if the remote is empty.

Usage:  python3 scripts/bootstrap-github.py
"""
import json, os, re, subprocess, sys, urllib.request, urllib.error

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
API = "https://api.github.com"

# ---------- .env ----------
env = {}
env_path = os.path.join(REPO_DIR, ".env")
if not os.path.exists(env_path):
    sys.exit(
        "ERROR: .env not found in the repository root. Create it with:\n"
        "  GITHUB_TOKEN=github_pat_...\n"
        "  GITHUB_REPO=ricklkiwi/astrocatalog"
    )
for line in open(env_path):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
TOKEN = env.get("GITHUB_TOKEN") or sys.exit("ERROR: GITHUB_TOKEN missing from .env")
REPO = env.get("GITHUB_REPO", "ricklkiwi/astrocatalog")

def gh(method, path, data=None, ok=(200, 201)):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "astrotracker-bootstrap",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or "{}")
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: cannot reach api.github.com ({e.reason}). Check your internet connection/proxy.")

# ---------- sanity ----------
code, repo_info = gh("GET", f"/repos/{REPO}")
if code != 200:
    sys.exit(f"ERROR: cannot access {REPO} (HTTP {code}). Check token permissions (Contents + Issues, read/write).")
print(f"Repo OK: {REPO}")

# ---------- permission pre-flight (--check) ----------
def preflight():
    results = []
    def check(name, passed, detail=""):
        results.append(passed)
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

    print("\nPermission pre-flight (no visible changes made):")

    code, user = gh("GET", "/user")
    check("Token valid / identity", code == 200,
          f"authenticated as {user.get('login')}" if code == 200 else f"HTTP {code}")

    perms = repo_info.get("permissions", {})
    check("Repository visible to token", True, f"permissions reported: {perms or 'n/a'}")

    # Contents: read
    code, _ = gh("GET", f"/repos/{REPO}/contents/")
    check("Contents: read", code in (200, 404),
          "repo reachable (empty repo returns 404 here - fine)" if code == 404 else f"HTTP {code}")

    # Contents: write - create a dangling git blob (invisible, unreferenced, auto-GC'd).
    # 409 = repo is empty; blob API unavailable there, so fall back to permissions object.
    code, _ = gh("POST", f"/repos/{REPO}/git/blobs",
                 {"content": "permission-check", "encoding": "utf-8"})
    if code == 409:
        check("Contents: write", perms.get("push", False),
              "empty repo - verified via permissions.push instead" if perms.get("push") else "permissions.push is false")
    else:
        check("Contents: write", code == 201,
              "verified via unreferenced test blob" if code == 201 else f"HTTP {code} - grant Contents: Read and write")

    # Issues: write - create then delete a temp label
    code, _ = gh("POST", f"/repos/{REPO}/labels",
                 {"name": "permission-check-temp", "color": "ededed"})
    if code in (201, 422):  # 422 = leftover from a previous run
        req = urllib.request.Request(
            f"{API}/repos/{REPO}/labels/permission-check-temp", method="DELETE",
            headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "astrotracker-bootstrap"})
        try:
            urllib.request.urlopen(req)
            check("Issues: write (labels + issues)", True, "verified via temp label create/delete")
        except urllib.error.HTTPError as e:
            check("Issues: write (labels + issues)", False, f"label delete HTTP {e.code}")
    else:
        check("Issues: write (labels + issues)", False,
              f"HTTP {code} - grant Issues: Read and write")

    # Issues: read
    code, _ = gh("GET", f"/repos/{REPO}/issues?per_page=1")
    check("Issues: read", code == 200, "" if code == 200 else f"HTTP {code}")

    if all(results):
        print("\nAll required permissions granted. Run without --check to bootstrap.")
        sys.exit(0)
    print("\nMissing permissions - fix the FAIL items above")
    print("(github.com -> Settings -> Developer settings -> Fine-grained tokens -> edit token")
    print(f" -> Repository access: {REPO} -> Permissions: Contents + Issues = Read and write)")
    sys.exit(1)

if "--check" in sys.argv:
    preflight()

# ---------- 1. push docs ----------
def run(*cmd, **kw):
    return subprocess.run(cmd, cwd=REPO_DIR, check=True, capture_output=True, text=True, **kw)

def push_current():
    """Push local commits to main using the token via GIT_ASKPASS (never written to disk config)."""
    askpass = os.path.join(REPO_DIR, ".git-askpass.sh")
    with open(askpass, "w") as f:
        f.write('#!/bin/sh\ncase "$1" in Username*) echo x-access-token;; *) echo "$GITHUB_TOKEN";; esac\n')
    os.chmod(askpass, 0o700)
    e2 = dict(os.environ, GITHUB_TOKEN=TOKEN, GIT_ASKPASS=askpass)
    subprocess.run(["git", "push", "-u", f"https://github.com/{REPO}.git", "main"],
                   cwd=REPO_DIR, check=True, env=e2)
    os.remove(askpass)

if "--push" in sys.argv:
    # Push any local commits in this repository and exit.
    push_current()
    print("Pushed local commits to main. Done.")
    sys.exit(0)

branch = repo_info.get("default_branch") or "main"
code, _ = gh("GET", f"/repos/{REPO}/contents/README.md")
if code == 200:
    print("Remote already has content - skipping push (use --push to push local commits).")
else:
    if not os.path.isdir(os.path.join(REPO_DIR, ".git")):
        run("git", "init", "-b", "main")
    run("git", "add", "-A")
    try:
        run("git", "-c", "user.name=AstroTracker Bootstrap", "-c", "user.email=ricklaird@gmail.com",
            "commit", "-m", "docs: initial planning and design documents\n\nPRD, development plan, task breakdown, DD-001..DD-008, agent instructions")
    except subprocess.CalledProcessError as e:
        if "nothing to commit" not in e.stdout + e.stderr:
            raise
    push_current()
    print("Docs pushed (initial commit on main).")

# ---------- 2. labels ----------
LABELS = {
    "phase:0": "6f42c1", "phase:1": "0e8a16", "phase:2": "1d76db", "phase:3": "fbca04",
    "phase:4": "d93f0b", "phase:5": "b60205",
    "pkg:core": "c2e0c6", "pkg:db": "bfd4f2", "pkg:desktop": "d4c5f9", "pkg:cloud": "c5def5",
    "type:feat": "0052cc", "type:infra": "5319e7", "type:test": "e99695", "type:docs": "f9d0c4",
}
made = 0
for name, color in LABELS.items():
    code, _ = gh("POST", f"/repos/{REPO}/labels", {"name": name, "color": color})
    made += code == 201
print(f"Labels: {made} created, {len(LABELS)-made} already existed.")

# ---------- 3. issues ----------
issues = json.load(open(os.path.join(REPO_DIR, "issues-phase-0-1.json")))

existing = {}   # task-id -> issue number
page = 1
while True:
    code, batch = gh("GET", f"/repos/{REPO}/issues?state=all&per_page=100&page={page}")
    if code != 200 or not batch:
        break
    for it in batch:
        m = re.match(r"\[(P\d+-\d+)\]", it.get("title", ""))
        if m:
            existing[m.group(1)] = it["number"]
    page += 1

num = dict(existing)
created = 0
for iss in issues:                      # already in P0-01..P1-34 order
    if iss["id"] in num:
        continue
    code, res = gh("POST", f"/repos/{REPO}/issues",
                   {"title": iss["title"], "body": iss["body"], "labels": iss["labels"]})
    if code != 201:
        sys.exit(f"ERROR creating {iss['id']}: HTTP {code} {res.get('message')}")
    num[iss["id"]] = res["number"]
    created += 1
    print(f"  created #{res['number']}  {iss['title']}")
print(f"Issues: {created} created, {len(issues)-created} already existed.")

# ---------- 4. rewrite dependency links ----------
patched = 0
for iss in issues:
    if not iss["deps"]:
        continue
    body = iss["body"]
    new = re.sub(r"\*\*Depends on:\*\* (.+)",
                 lambda m: "**Depends on:** " + ", ".join(
                     f"#{num[d]} ({d})" if d in num else d
                     for d in re.findall(r"P\d+-\d+", m.group(1))),
                 body)
    if new != body:
        code, _ = gh("PATCH", f"/repos/{REPO}/issues/{num[iss['id']]}", {"body": new})
        patched += code == 200
print(f"Dependency links rewritten on {patched} issues.")
print(f"\nDone: https://github.com/{REPO}/issues")
print("Reminder: revoke or keep the token as you prefer; enable branch protection on main.")
