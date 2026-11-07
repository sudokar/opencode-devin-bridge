#!/usr/bin/env bash
#
# opencode-devin-bridge — one-line installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sudokar/opencode-devin-bridge/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/sudokar/opencode-devin-bridge/main/install.sh | bash -s -- --no-login
#   curl -fsSL https://raw.githubusercontent.com/sudokar/opencode-devin-bridge/main/install.sh | bash -s -- --force
#
# What this does:
#   1. Verifies opencode is on PATH (does NOT install opencode for you).
#   2. Verifies the separately authenticated Devin CLI can list models.
#   3. Backs up ~/.config/opencode/opencode.json (or its XDG-resolved
#      equivalent) before any edit.
#   4. Merges these into your existing config — DOES NOT touch anything
#      else you already had:
#        - `"plugins": ["opencode-devin-bridge@beta"]`  (additive)
#        - `"providers.devin"`  (only if absent; --force overrides)
#   5. Runs `opencode auth login devin` to sign you in.
#      Skip with `--no-login`.
#
# What this script does NOT do (and why):
#   - No `bun add`, no clone, no build. opencode resolves the plugin
#     directly from npm via its own cache when it sees the plugin entry
#     in opencode.json.
#   - No Windsurf-IDE check. This plugin is cloud-direct; you do not
#     need Windsurf installed.
#

set -euo pipefail

# ── tiny logger ──────────────────────────────────────────────────────
# Color only when BOTH fds we use are TTYs. log/ok go to fd 1 (banner +
# happy-path progress); warn/die go to fd 2 (diagnostics). Honoring
# `NO_COLOR` is the standard opt-out for users who pipe our output.
if [[ -t 1 && -t 2 && -z "${NO_COLOR:-}" ]]; then
  BLUE=$'\033[1;34m'; GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[1;31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BLUE=''; GREEN=''; YELLOW=''; RED=''; DIM=''; RESET=''
fi
log()  { printf '%s┃ %s%s\n' "$BLUE"   "$*" "$RESET"; }
ok()   { printf '%s✓ %s%s\n' "$GREEN"  "$*" "$RESET"; }
# diagnostics → stderr (so a user piping our output to a log file still
# sees warnings/errors on their terminal, and downstream tools like
# `tee` keep working).
warn() { printf '%s! %s%s\n' "$YELLOW" "$*" "$RESET" >&2; }
die()  { printf '%s✗ %s%s\n' "$RED"    "$*" "$RESET" >&2; exit 1; }

# ── parse args ───────────────────────────────────────────────────────
LOGIN=1
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --no-login) LOGIN=0 ;;
    --force)    FORCE=1 ;;
    -h|--help)
      # NOTE: inline heredoc instead of `sed -n '...' "$0"` because $0 is
      # `bash` (not the script path) when users curl-pipe the installer,
      # which made `--help` print `sed: bash: No such file or directory`
      # in the documented one-line install path.
      cat <<'HELP'
opencode-devin-bridge installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/sudokar/opencode-devin-bridge/main/install.sh | bash
  curl -fsSL .../install.sh | bash -s -- --no-login
  curl -fsSL .../install.sh | bash -s -- --force

Options:
  --no-login   Skip the "opencode auth login" step at the end
  --force      Overwrite an existing providers.devin block (default: keep yours)
  -h, --help   Show this message and exit

What this does:
  1. Verifies opencode is on PATH (does not install opencode for you).
  2. Verifies the Devin CLI can list the models available to your account.
  3. Backs up ~/.config/opencode/opencode.json before any edit.
  4. Merges into your existing config (additive — your other settings
     are untouched):
       - "plugins": ["opencode-devin-bridge@beta"]
       - "providers.devin"  (only if absent, unless --force)
  5. Runs "opencode auth login devin" so you can sign in.

NO_COLOR=1 disables ANSI color output.
HELP
      exit 0
      ;;
    *) die "Unknown argument: $arg  (try --help)" ;;
  esac
done

# ── banner ───────────────────────────────────────────────────────────
printf '\n%sopencode-devin-bridge installer%s\n' "$BLUE" "$RESET"
printf '%s%s%s\n\n' "$DIM" "Devin provider for opencode — cloud-direct, no IDE required" "$RESET"

# ── 1. opencode present? ─────────────────────────────────────────────
#
# Note: when this installer runs via `curl ... | bash`, bash is launched
# NON-interactively and does NOT source ~/.bashrc / ~/.zshrc. opencode's
# own installer adds its bin directory to those rc files, so users who
# just installed opencode in their interactive shell may not have it on
# the non-interactive PATH. Probe a few well-known install locations
# before failing so the recommended "install opencode then run our
# wizard" flow Just Works.
log "Checking for opencode..."
# Guard the probe loop and the XDG fallback against unset HOME, which
# `set -u` turns into a hard abort. Empty HOME happens in some cron jobs,
# Docker images, and systemd unit defaults — we don't want to die on
# `HOME: unbound variable` before we even get to print a useful error.
if [[ -z "${HOME:-}" ]]; then
  die "HOME environment variable is not set. The installer needs HOME to
  locate opencode and your config dir. Re-run with HOME exported, e.g.:
    HOME=/path/to/your/home bash install.sh"
fi
if ! command -v opencode >/dev/null 2>&1; then
  for CAND in \
    "$HOME/.opencode/bin/opencode" \
    "$HOME/.bun/bin/opencode" \
    "$HOME/.local/bin/opencode" \
    "/usr/local/bin/opencode" \
    "/opt/homebrew/bin/opencode"; do
    if [[ -x "$CAND" ]]; then
      export PATH="$(dirname "$CAND"):$PATH"
      log "Found opencode at $CAND (added its dir to PATH for this run)"
      break
    fi
  done
fi
if ! command -v opencode >/dev/null 2>&1; then
  die "opencode not found on PATH.

Install it first: https://opencode.ai/docs/intro/#install
Then re-run this installer.

(If you just installed opencode, source your shell rc — e.g.
  source ~/.zshrc   # or ~/.bashrc
— so opencode is on PATH, then re-run.)"
fi
# Strip ANSI / control characters from --version in case a future opencode
# release decides to colorize it. Single line, printable chars only.
# Capture the full output FIRST, then slice it locally — never pipe
# opencode's stdout into another command. Two reasons under `set -euo
# pipefail`:
#   (1) If we did `opencode --version | head -n1 | tr ...`, and a future
#       opencode release emits >1 line, `head -n1` would close its pipe
#       after the first line, opencode would get SIGPIPE and exit 141,
#       and pipefail would mark the whole pipeline failed → we'd fall
#       back to "unknown" even though the version is fine.
#   (2) If opencode exits non-zero AFTER writing partial output, a
#       `|| echo unknown` chained to the pipe would CONCATENATE the
#       partial bytes with "unknown" → "v1.0unknown" in the banner.
# Capturing first sidesteps both. If opencode itself errors out, we
# fall through to the empty-string default.
# Wrap with `timeout` when available so a hung opencode binary (deadlocked
# telemetry, broken license check, etc.) doesn't freeze the installer
# forever on the "Checking for opencode..." line. macOS ships without GNU
# `timeout` but Homebrew coreutils installs it as `gtimeout`; if neither
# is on PATH we accept the small hang risk rather than re-implementing
# `timeout` in pure bash 3.2.
# `--kill-after=2` follows up SIGTERM with SIGKILL two seconds later, in
# case a stuck opencode ignores the initial TERM (signal handler stuck on
# a mutex, etc.). GNU coreutils' timeout supports this; BSD/macOS without
# Homebrew coreutils falls through to the no-timeout branch.
if command -v timeout >/dev/null 2>&1; then
  OC_VERSION_RAW="$(timeout --kill-after=2 10 opencode --version 2>/dev/null)" || OC_VERSION_RAW=""
elif command -v gtimeout >/dev/null 2>&1; then
  OC_VERSION_RAW="$(gtimeout --kill-after=2 10 opencode --version 2>/dev/null)" || OC_VERSION_RAW=""
else
  OC_VERSION_RAW="$(opencode --version 2>/dev/null)" || OC_VERSION_RAW=""
fi
# First line, printable chars only (strip ANSI escapes if a future
# opencode adds color to --version). Critically: do the "first line"
# extraction via bash parameter expansion rather than a pipeline. An
# earlier version pipelined `printf | read | printf | tr`, which under
# `set -euo pipefail` aborts the WHOLE installer with SIGPIPE/141 when
# the input is larger than the pipe buffer with a newline early in it
# — i.e. a future verbose --version banner would brick this script
# before it reached the merge step.
#
# sed strips ANSI CSI sequences (ESC `[` ... terminator) BEFORE the tr
# step. Plain `tr -dc '[:print:]'` only removes the ESC byte itself, so
# colorized output like `\033[1;31mv1.2.3\033[0m` would leak the
# `[1;31m` / `[0m` residue into the banner — they are printable chars.
OC_VERSION_RAW="${OC_VERSION_RAW%%$'\n'*}"
OC_VERSION="$(printf '%s' "$OC_VERSION_RAW" | LC_ALL=C sed $'s/\033\\[[0-9;?]*[a-zA-Z]//g' | tr -dc '[:print:]')" || OC_VERSION=""
[[ -z "$OC_VERSION" ]] && OC_VERSION="unknown"
ok "opencode $OC_VERSION"
if [[ ! "$OC_VERSION" =~ ([0-9]+)\.([0-9]+)\.([0-9]+) ]]; then
  die "Cannot determine the OpenCode version. This release requires OpenCode 2.2.6 or newer."
fi
OC_MAJOR=${BASH_REMATCH[1]}; OC_MINOR=${BASH_REMATCH[2]}; OC_PATCH=${BASH_REMATCH[3]}
if (( 10#$OC_MAJOR < 2 || (10#$OC_MAJOR == 2 && 10#$OC_MINOR < 2) || (10#$OC_MAJOR == 2 && 10#$OC_MINOR == 2 && 10#$OC_PATCH < 6) )); then
  die "OpenCode 2.2.6 or newer is required. Install an older bridge release for OpenCode V1."
fi

# ── 2. Devin CLI preflight ────────────────────────────────────────────
# JSON output avoids an interactive pager or TTY-specific table output.
# This comes before resolving or creating the config directory, so a missing
# or unauthenticated CLI leaves opencode untouched.
log "Checking Devin CLI model access..."
if ! command -v devin >/dev/null 2>&1; then
  die "Devin CLI not found on PATH.

Install the Devin CLI, authenticate it with your Devin account, then verify:
  devin models list --format json

This is separate from \`opencode auth login devin\`; the installer
needs the Devin CLI to seed the model catalog available to your account."
fi
if ! devin models list --format json >/dev/null 2>&1; then
  die "Devin CLI could not list models (\`devin models list --format json\` failed).

Authenticate or repair the Devin CLI, then verify the command succeeds:
  devin models list --format json

No opencode configuration was created or changed, and OAuth was not started."
fi
ok "Devin CLI can list models"

# ── 3. pick a JSON-merge helper ──────────────────────────────────────
log "Looking for a JSON-merge runtime..."
if   command -v bun     >/dev/null 2>&1; then RUNTIME="bun";     RUNTIME_KIND="js"
elif command -v node    >/dev/null 2>&1; then RUNTIME="node";    RUNTIME_KIND="js"
elif command -v python3 >/dev/null 2>&1; then RUNTIME="python3"; RUNTIME_KIND="py"
else
  die "Need bun, node, or python3 on PATH for safe JSON merging. (opencode itself bundles bun, but the installer needs one of these on the host shell.)"
fi
ok "using $RUNTIME"

# ── 4. find the right config file ────────────────────────────────────
#
# Per https://opencode.ai/docs/config — the global user config path is
# `~/.config/opencode/` on macOS, Linux, AND Windows. opencode does NOT
# use %APPDATA% on Windows — it follows the XDG convention everywhere.
# So ${XDG_CONFIG_HOME:-$HOME/.config} is correct on all platforms.
#
# opencode supports BOTH opencode.json and opencode.jsonc, and merges
# them together if both exist. We only touch the .json variant because
# JSON.parse can't read .jsonc's comments — leaving .jsonc untouched
# preserves any commented configuration the user may have.
# Per XDG basedir spec, XDG_CONFIG_HOME MUST be absolute when set. A
# relative value (or just a sketchy one inherited from a wrapper script
# or sourced .env) would silently redirect our writes to `$PWD/<rel>/
# opencode/opencode.json` — almost never what the user wants. Refuse
# rather than guess. Empty/unset already falls through to ~/.config.
#
# Accept POSIX absolute (`/foo/bar`) OR Windows-drive absolute
# (`C:/foo/bar` or `C:\foo\bar`) so Git Bash / MSYS users who pass a
# native Win path don't hit the refusal. Pure relative paths are still
# blocked.
if [[ -n "${XDG_CONFIG_HOME:-}" ]] && ! [[ "$XDG_CONFIG_HOME" =~ ^(/|[A-Za-z]:[\\/]) ]]; then
  die "XDG_CONFIG_HOME=$XDG_CONFIG_HOME is not an absolute path.

The installer refuses to guess where to write your config. Set
XDG_CONFIG_HOME to an absolute path (POSIX '/foo' or Windows 'C:/foo')
or unset it, then re-run."
fi
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
CONFIG="$CONFIG_DIR/opencode.json"
CONFIG_JSONC="$CONFIG_DIR/opencode.jsonc"
log "Config: $CONFIG"

# Refuse to operate on a symlink-shaped config OR a symlinked config
# directory — BEFORE `mkdir -p`, because mkdir -p on a dangling symlink
# fails with a cryptic "No such file or directory" error that aborts the
# script (set -e) before the friendly diagnostic block below ever runs.
#
# `[[ -f path ]]` follows symlinks; if our writes land at a symlink target
# rather than the intended path, an attacker with same-uid write access
# could redirect them to ~/.ssh/authorized_keys, ~/.bashrc, etc. Checking
# the file AND the immediate directory closes the simple cases of someone
# planting a symlink at $CONFIG or $CONFIG_DIR.
#
# Best-effort, NOT a security boundary: we do not walk the entire ancestor
# chain (so a symlinked ~/.config itself bypasses this check), and there is
# an unavoidable TOCTOU window between the -L check and the actual rename
# inside the JS/Python merge. The real defense against same-uid attackers
# is filesystem permissions; this just catches the most common foot-guns.
if [[ -L "$CONFIG_DIR" ]]; then
  CONFIG_DIR_Q=$(printf '%q' "$CONFIG_DIR")
  die "$CONFIG_DIR is a symbolic link.

Refusing to operate inside it — a symlinked config directory can redirect
our writes anywhere you have permission to write. If you intentionally
symlinked the directory (e.g. from a dotfile repo), use the manual install
in the README instead. Otherwise remove the symlink:
  rm $CONFIG_DIR_Q"
fi

mkdir -p "$CONFIG_DIR"

# Re-check after mkdir in case the directory was created (or planted as a
# symlink) in between. Cheap belt-and-suspenders for the TOCTOU caveat
# above.
if [[ -L "$CONFIG_DIR" ]]; then
  CONFIG_DIR_Q=$(printf '%q' "$CONFIG_DIR")
  die "$CONFIG_DIR became a symbolic link during install setup. Aborting."
fi

if [[ -L "$CONFIG" ]]; then
  CONFIG_Q=$(printf '%q' "$CONFIG")
  die "$CONFIG is a symbolic link.

Refusing to write through it — a symlink at the config path can redirect
our writes to anywhere you have permission to write. If you intentionally
symlinked opencode.json (e.g. from a dotfile repo), use the manual install
in the README instead. Otherwise delete the symlink:
  rm $CONFIG_Q"
fi
if [[ -L "$CONFIG_JSONC" ]]; then
  warn "$CONFIG_JSONC is a symlink. Leaving it alone, but be aware that opencode loads through this symlink — verify it points where you expect."
fi
if [[ -f "$CONFIG_JSONC" ]] && grep -q 'opencode-devin-bridge' "$CONFIG_JSONC"; then
  die "$CONFIG_JSONC mentions opencode-devin-bridge. Remove or migrate that entry manually before using this installer; it cannot safely edit JSONC."
fi

if [[ ! -f "$CONFIG" ]]; then
  if [[ -f "$CONFIG_JSONC" ]]; then
    warn "Found opencode.jsonc but no opencode.json. Creating opencode.json"
    warn "alongside — opencode will load and merge both. Your .jsonc stays untouched."
  fi
  # Create a fresh config as 0600 (mode-preserving rewrite later inherits
  # this). opencode.json may end up holding provider API keys, so even
  # the empty placeholder should default to user-only readable rather
  # than whatever the ambient umask was (typically 0644 = world-readable).
  # `set -C` matches the backup branch: if a same-uid attacker planted a
  # symlink at $CONFIG between the -L check above and this redirect,
  # noclobber refuses rather than following it.
  # Capture stderr so a quota/EROFS/EDQUOT user sees the real cause,
  # not the misleading generic "file exists, symlink planted" wording.
  # Matches the backup branch's `BACKUP_ERR` pattern.
  if ! CREATE_ERR=$( ( umask 077; set -C; printf '{}\n' > "$CONFIG" ) 2>&1 ); then
    die "Could not create $CONFIG:
  $CREATE_ERR

Possible causes: a file or symlink was pre-planted at the config path
(noclobber refused to follow it); the directory is read-only; disk is
full; or you're over quota."
  fi
  ok "created fresh opencode.json (mode 0600)"
fi

# ── 5. backup ────────────────────────────────────────────────────────
# Append `$$` (PID) and `${RANDOM:-0}` so two concurrent runs in the same
# wall-clock second don't overwrite each other's backups. `date +%N` for
# nanoseconds isn't portable to macOS, so this is the safer alternative.
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="$CONFIG.bak-$TS-$$-${RANDOM:-0}"
# Belt-and-suspenders: if the suffix STILL collides (e.g. SOURCE_DATE_EPOCH
# games or against pre-planted symlinks), keep bumping a counter rather
# than clobbering an existing file. `-e` alone misses DANGLING symlinks
# (they exist as inodes but `-e` follows them to a missing target and
# returns false); add `-L` to catch those too.
COUNTER=0
while { [[ -e "$BACKUP" || -L "$BACKUP" ]]; } && [[ $COUNTER -lt 50 ]]; do
  COUNTER=$((COUNTER+1))
  BACKUP="$CONFIG.bak-$TS-$$-${RANDOM:-0}-$COUNTER"
done
{ [[ -e "$BACKUP" || -L "$BACKUP" ]]; } && die "Could not find a unique backup filename after 50 attempts (check $CONFIG_DIR for stale files)."
# Write the backup under `set -C` (noclobber): if anything raced in
# between the existence check above and this write (e.g. a same-uid
# attacker pre-planting a symlink at $BACKUP to redirect the write to
# ~/.ssh/authorized_keys), the O_CREAT|O_EXCL semantics make the
# redirect refuse rather than follow the symlink. `cat | redirect`
# instead of `cp` because cp follows symlinks at dst and has no
# noclobber flag we can rely on cross-platform.
#
# `umask 077` so the backup is 0600 even when the user has a permissive
# default umask. opencode.json can hold provider API keys / refresh
# tokens; a 0644 backup sibling on a shared host or tmpfs would leak.
#
# Capture stderr so the user sees the REAL reason when this fails —
# the noclobber case looks like "$BACKUP: cannot overwrite existing
# file", but disk-full, EACCES on $CONFIG, EROFS, etc. all produce
# different (and more actionable) errors that were previously swallowed
# behind a misleading "symlink was planted" diagnostic.
if ! BACKUP_ERR=$( ( umask 077; set -C; cat "$CONFIG" > "$BACKUP" ) 2>&1 ); then
  die "Backup write to $BACKUP failed:
  $BACKUP_ERR

Possible causes: a file or symlink was pre-planted at the backup path
(noclobber refused to follow it — see the noclobber explanation above);
disk is full; $CONFIG is unreadable; or the directory is read-only."
fi
ok "backed up → $(basename "$BACKUP")"

# ── 6. merge our recommended config ──────────────────────────────────
log "Merging Devin provider + plugin entry..."

# Single source of truth for the merge logic. Both runtimes accept it via
# stdin so we don't have to ship two copies of the model catalog.
if [[ "$RUNTIME_KIND" == "js" ]]; then
  FORCE_FLAG=$([ "$FORCE" -eq 1 ] && echo "true" || echo "false")
  # NOTE: wrapped in try/catch + process.exit(1). Bun (1.2.x at least)
  # has a quirk where uncaught exceptions inside `bun -e '...'` — including
  # JSON.parse SyntaxErrors — exit the process with status 0. Node and
  # most JS runtimes exit non-zero on uncaught throws, but bun doesn't,
  # which silently masked malformed-input failures in earlier versions
  # of this installer (the script would log "opencode.json updated" while
  # actually having written nothing). Explicit exit(1) on catch fixes it.
  #
  # We also capture stdout so we can grep for a `__MERGE_OK__` sentinel:
  # a broken-stub runtime (zero-byte bun, broken alias, etc.) that exits
  # 0 without running our script would otherwise let the installer claim
  # success while leaving the config untouched.
  #
  # The trailing `|| MERGE_RC=$?` is critical: under `set -e`, a non-zero
  # exit from the inner runtime (e.g. malformed JSON → process.exit(1))
  # would abort the script BEFORE our sentinel check ran, hiding the
  # friendly "backup is at $BACKUP" message. Capturing the exit code lets
  # us route BOTH failure paths (runtime crash, missing sentinel) through
  # the unified diagnostic below.
  MERGE_RC=0
  MERGE_OUT=$("$RUNTIME" -e '
    try {
    const fs = require("fs");
    const path = process.argv[1];
    const force = process.argv[2] === "true";
    let cur;
    try { cur = JSON.parse(fs.readFileSync(path, "utf8")); }
    catch (parseErr) {
      console.error("✗ existing opencode.json is not valid JSON:", parseErr.message);
      console.error("  fix or delete " + path + " and re-run.");
      process.exit(1);
    }
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
      console.error("✗ existing opencode.json does not contain a JSON object at the top level.");
      process.exit(1);
    }

    // Only set the schema URL if the existing value is not already a
    // string. `||` would replace falsy strings (e.g. `""`) but leave
    // truthy non-strings (`42`, `["x"]`) — diverging from the Python
    // branch and producing inconsistent output across runtimes.
    if (typeof cur["$schema"] !== "string" || cur["$schema"].length === 0) {
      cur["$schema"] = "https://opencode.ai/config.json";
    }

    // Move only our V1 entry; preserve every unrelated plugin and option.
    if (cur.plugins !== undefined && !Array.isArray(cur.plugins)) throw new Error("plugins must be an array");
    if (cur.plugin !== undefined && !Array.isArray(cur.plugin)) throw new Error("plugin must be an array");
    if (!cur.plugins) cur.plugins = [];
    const PLUGIN = "opencode-devin-bridge@beta";
    const isBridge = (p) => {
      const name = typeof p === "string" ? p : Array.isArray(p) ? p[0] : p?.package;
      return typeof name === "string" && name.replace(/@[^/]*$/, "") === "opencode-devin-bridge";
    };
    if (!cur.plugins.some(isBridge)) {
      const legacy = Array.isArray(cur.plugin) ? cur.plugin.find(isBridge) : undefined;
      cur.plugins.push(Array.isArray(legacy) ? { package: legacy[0], options: legacy[1] } : legacy || PLUGIN);
    }
    cur.plugins = cur.plugins.map((p) => {
      const name = typeof p === "string" ? p : p?.package;
      if (typeof name !== "string" || !name.startsWith("opencode-devin-bridge@")) return p;
      const spec = name.slice("opencode-devin-bridge@".length);
      if (!/(^|[\s^~=<>v|])1(?=[.\-x*\s|]|$)/.test(spec) && !/<=?\s*2(?!\d)/.test(spec)) return p;
      console.error("  (upgraded V1 bridge pin to " + PLUGIN + ")");
      return typeof p === "string" ? PLUGIN : { ...p, package: PLUGIN };
    });
    if (Array.isArray(cur.plugin)) cur.plugin = cur.plugin.filter((p) => !isBridge(p));

    // Keep an existing native or legacy provider; the plugin supplies models.
    if (cur.providers !== undefined && (!cur.providers || typeof cur.providers !== "object" || Array.isArray(cur.providers))) throw new Error("providers must be an object");
    if (!cur.providers) cur.providers = {};
    const existingDevin = Object.prototype.hasOwnProperty.call(cur.providers, "devin") ? cur.providers.devin : cur.provider?.devin;
    const has = existingDevin && typeof existingDevin === "object" && !Array.isArray(existingDevin);
    // `had` distinguishes "devin was present but malformed (null,
    // array, primitive)" from "devin was truly absent" — only
    // matters for the log message wording at the bottom of this branch.
    const had = existingDevin !== undefined;
    if (!has || force) {
      cur.providers.devin = {
        name: "Devin",
        package: "@opencode/ai/providers/openai-compatible",
        settings: { baseURL: "http://127.0.0.1:42124/v1" },
      };
      console.error(
        has  ? "  (--force: overwrote existing providers.devin)" :
        had  ? "  (replaced malformed providers.devin — was not a valid object)" :
               "  (added providers.devin)"
      );
    } else {
      console.error("  (kept your existing Devin provider — re-run with --force to replace)");
    }

    // Atomic write: serialize to a sibling tmp file, then rename. fs.rename
    // is atomic on POSIX same-filesystem operations — concurrent installer
    // runs cannot interleave bytes mid-write, and a crash between the
    // write and rename leaves the original untouched (still valid).
    //
    // Use O_EXCL + an unpredictable random suffix so a same-uid attacker
    // who can guess our PID cannot pre-plant a symlink at the tmp path
    // and redirect our write to ~/.ssh/authorized_keys. Mirrors the
    // noclobber protection on the backup step.
    //
    // Preserve the ORIGINAL file mode (so a 0600 user-tightened config
    // stays 0600). Files opened with 0600 here can only get TIGHTER
    // via chmodSync below, never wider.
    const crypto = require("crypto");
    const tmp = path + ".tmp." + process.pid + "." + crypto.randomBytes(6).toString("hex");
    // writeFileSync with `flag: "wx"` uses O_CREAT|O_EXCL — fails if
    // anything (including a symlink) already exists at tmp. It also
    // handles partial-writes internally (looping on short writes from
    // signals / NFS / FUSE), which raw fs.writeSync(fd, string) does
    // not.
    // Single try/finally covers write + chmod + rename. If ANY of those
    // throws (ENOSPC mid-write, EIO, EXDEV cross-fs rename, etc.), the
    // finally unconditionally removes the tmp so we never leak a
    // partially-written `.tmp.<pid>.<hex>` next to the user config.
    // Matches the Python branch structure.
    try {
      fs.writeFileSync(tmp, JSON.stringify(cur, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      try {
        // Use lstat (not stat) so a same-uid attacker who swaps $CONFIG for
        // a symlink to e.g. /etc/passwd between the bash -L check and now
        // cannot trick us into copying the TARGET wider 0644 mode onto
        // our config. Also cap with bitwise-AND 0o600 so the mode can
        // only be TIGHTENED, never widened, across runs.
        const originalMode = fs.lstatSync(path).mode & 0o777;
        fs.chmodSync(tmp, originalMode & 0o600);
      } catch (_e) {
        // ENOENT (no original to copy mode from) is fine — keep 0600.
      }
      fs.renameSync(tmp, path);
    } finally {
      try { fs.unlinkSync(tmp); } catch (_e) {}
    }
    // Sentinel on stdout that bash greps for to confirm the merge actually
    // ran. Status messages go to stderr (so the user still sees them);
    // only this one line goes to stdout. A broken-stub runtime that exits
    // 0 without running the script will not print this and we abort.
    console.log("__MERGE_OK__");
    } catch (e) {
      console.error("✗ JSON merge failed:", e.message);
      process.exit(1);
    }
  ' "$CONFIG" "$FORCE_FLAG") || MERGE_RC=$?
else
  # python3 — same semantics, different syntax. Output capture mirrors the
  # JS branch so we can check for the __MERGE_OK__ sentinel; the trailing
  # `|| MERGE_RC=$?` again routes runtime crashes through the unified die.
  FORCE_PY=$([ "$FORCE" -eq 1 ] && echo "1" || echo "0")
  MERGE_RC=0
  MERGE_OUT=$(FORCE="$FORCE_PY" "$RUNTIME" - "$CONFIG" <<'PY'
import json, os, sys, re
path = sys.argv[1]
force = os.environ.get("FORCE") == "1"

try:
    with open(path) as f: cur = json.load(f)
except json.JSONDecodeError as e:
    print(f"✗ existing opencode.json is not valid JSON: {e}", file=sys.stderr)
    print(f"  fix or delete {path} and re-run.", file=sys.stderr)
    sys.exit(1)

if not isinstance(cur, dict):
    print("✗ existing opencode.json does not contain a JSON object at the top level.", file=sys.stderr)
    sys.exit(1)

# Mirror the JS branch: only set the schema if the existing value is
# missing OR not a non-empty string. setdefault alone would preserve a
# hand-edited `"$schema": 0` / `null` / `[...]`, diverging from JS.
if not isinstance(cur.get("$schema"), str) or not cur["$schema"]:
    cur["$schema"] = "https://opencode.ai/config.json"

if "plugins" in cur and not isinstance(cur["plugins"], list):
    raise ValueError("plugins must be an array")
if "plugin" in cur and not isinstance(cur["plugin"], list):
    raise ValueError("plugin must be an array")
cur.setdefault("plugins", [])
def is_bridge(p):
    name = p if isinstance(p, str) else p[0] if isinstance(p, list) and p else p.get("package") if isinstance(p, dict) else None
    return isinstance(name, str) and re.sub(r"@[^/]*$", "", name) == "opencode-devin-bridge"
if not any(is_bridge(p) for p in cur["plugins"]):
    legacy = next((p for p in cur.get("plugin", []) if is_bridge(p)), None)
    cur["plugins"].append({"package": legacy[0], "options": legacy[1]} if isinstance(legacy, list) else legacy or "opencode-devin-bridge@beta")
for i, p in enumerate(cur["plugins"]):
    name = p if isinstance(p, str) else p.get("package") if isinstance(p, dict) else None
    spec = name[len("opencode-devin-bridge@"):] if isinstance(name, str) and name.startswith("opencode-devin-bridge@") else None
    if spec is not None and (re.search(r"(^|[\s^~=<>v|])1(?=[.\-x*\s|]|$)", spec) or re.search(r"<=?\s*2(?!\d)", spec)):
        print("  (upgraded V1 bridge pin to opencode-devin-bridge@beta)", file=sys.stderr)
        cur["plugins"][i] = "opencode-devin-bridge@beta" if isinstance(p, str) else {**p, "package": "opencode-devin-bridge@beta"}
if "plugin" in cur:
    cur["plugin"] = [p for p in cur["plugin"] if not is_bridge(p)]

if "providers" in cur and not isinstance(cur["providers"], dict):
    raise ValueError("providers must be an object")
cur.setdefault("providers", {})
# Keep an existing native or legacy provider; the plugin supplies models.
# Treat devin: None (or any non-dict value) as ABSENT so we replace
# the broken entry rather than confusingly preserve it.
legacy_provider = cur.get("provider") if isinstance(cur.get("provider"), dict) else {}
existing_devin = cur["providers"].get("devin", legacy_provider.get("devin"))
has = isinstance(existing_devin, dict)
# `had` distinguishes "devin was present but malformed" from "absent"
# — only matters for the log message wording.
had = "devin" in cur["providers"] or "devin" in legacy_provider
if (not has) or force:
    cur["providers"]["devin"] = {
        "name": "Devin",
        "package": "@opencode/ai/providers/openai-compatible",
        "settings": {"baseURL": "http://127.0.0.1:42124/v1"},
    }
    if has:
        print("  (--force: overwrote existing providers.devin)", file=sys.stderr)
    elif had:
        print("  (replaced malformed providers.devin — was not a valid object)", file=sys.stderr)
    else:
        print("  (added providers.devin)", file=sys.stderr)
else:
    print("  (kept your existing Devin provider — re-run with --force to replace)", file=sys.stderr)

# Atomic write: serialize to a tmp file then `os.replace` (atomic rename
# on POSIX). See the JS branch for the same pattern + rationale.
#
# Use O_EXCL + an unpredictable random suffix so a same-uid attacker who
# can guess our PID cannot pre-plant a symlink at the tmp path and
# redirect our write. Mirrors the noclobber protection on the backup step.
# Preserve original mode so a 0600 user-tightened config doesn't get
# silently widened by the default umask.
tmp_suffix = os.urandom(6).hex()
tmp = f"{path}.tmp.{os.getpid()}.{tmp_suffix}"
try:
    # lstat (not stat) so a same-uid attacker swapping $CONFIG for a
    # symlink to e.g. /etc/passwd between bash's -L check and now can't
    # trick us into copying the TARGET's wider mode. Mask with 0o600 to
    # ensure we can only ever TIGHTEN, never widen.
    try: original_mode = os.lstat(path).st_mode & 0o777
    except FileNotFoundError: original_mode = None
    # O_WRONLY|O_CREAT|O_EXCL — fails if anything (including a symlink)
    # exists at tmp. Mode 0600 unless we later restore something tighter.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        # ensure_ascii=False keeps non-ASCII characters (`café`, emoji, etc.)
        # as-is. Default (`True`) would re-write existing unicode strings as
        # `\uXXXX` escapes, causing gratuitous diffs in users' dotfile repos
        # AND diverging from the JS branch's output.
        json.dump(cur, f, indent=2, ensure_ascii=False)
        f.write("\n")
    if original_mode is not None:
        os.chmod(tmp, original_mode & 0o600)
    os.replace(tmp, path)
finally:
    # Belt-and-suspenders: if anything went wrong between opening tmp
    # and renaming, don't leave the orphan tmp next to the existing config.
    try: os.unlink(tmp)
    except FileNotFoundError: pass

# Sentinel on stdout, matching the JS branch.
print("__MERGE_OK__")
PY
) || MERGE_RC=$?
fi

# Refuse to declare success if the merge runtime either crashed mid-run
# OR exited 0 without printing our sentinel. Both failure modes funnel
# through the same friendly diagnostic so the user always sees where the
# backup landed, regardless of which way the runtime misbehaved.
if (( MERGE_RC != 0 )) || [[ "$MERGE_OUT" != *"__MERGE_OK__"* ]]; then
  BACKUP_Q=$(printf '%q' "$BACKUP")
  CONFIG_Q=$(printf '%q' "$CONFIG")
  die "JSON merge did not complete (runtime: $RUNTIME, exit: $MERGE_RC).
Your config was NOT modified — the original is still at $CONFIG_Q and a
pre-install snapshot is at:
  $BACKUP_Q

If this keeps happening, ensure one of bun/node/python3 (in that order)
is healthy on PATH and re-run."
fi
ok "opencode.json updated"

# ── 7. sign in ────────────────────────────────────────────────────────
if (( LOGIN )); then
  echo
  log "Launching opencode auth login..."
  log "A browser tab will open. Sign in with your Devin account."
  echo
  if opencode auth login devin; then
    ok "signed in"
  else
    warn "auth login didn't complete cleanly — you can re-run \`opencode auth login devin\` any time"
  fi
fi
log "Refreshing your Devin model catalog..."
if command -v bunx >/dev/null 2>&1; then
  if bunx opencode-devin-bridge@beta sync-models; then ok "model catalog refreshed"; else warn "model catalog refresh failed"; fi
elif command -v npx >/dev/null 2>&1; then
  if npx --yes opencode-devin-bridge@beta sync-models; then ok "model catalog refreshed"; else warn "model catalog refresh failed"; fi
else
  warn "bunx or npx not found; run opencode-devin-bridge sync-models after installing the bridge CLI"
fi

# ── 8. done ──────────────────────────────────────────────────────────
#
# We build the restore command via `printf %q` rather than embedding
# "$BACKUP"/"$CONFIG" directly in a heredoc. If a path contains `$`,
# backtick, or backslash, the heredoc renders the literal characters,
# but when the user copies the displayed cp command back into their
# own shell, those characters get re-expanded by THEIR shell and the
# paste-back fails (e.g. `$weird` expands to empty). %q produces a
# shell-safe quoted form that round-trips correctly.
RESTORE_BACKUP_Q=$(printf '%q' "$BACKUP")
RESTORE_CONFIG_Q=$(printf '%q' "$CONFIG")

printf '\n%s🎉  Installation complete.%s\n\n' "$GREEN" "$RESET"
printf '%sTry it:%s\n'   "$BLUE"  "$RESET"
printf '  opencode run --model=devin/swe-1.6 "hi"\n'
printf '  opencode run --model=devin/kimi-k2.6 -f screenshot.png -- "describe this image"\n'
printf '  opencode run --model=devin/claude-opus-4.7#high "what does this codebase do?"\n\n'
printf '%sAnything broken?%s\n' "$BLUE"  "$RESET"
printf '  • Restore your previous config:  cp %s %s\n' "$RESTORE_BACKUP_Q" "$RESTORE_CONFIG_Q"
printf '  • Open an issue:  https://github.com/sudokar/opencode-devin-bridge/issues\n\n'
