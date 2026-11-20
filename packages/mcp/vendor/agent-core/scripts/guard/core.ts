import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Provenance of the pinned core (replaces the hash of agent-core/scripts in a product): the
// `agent-core` git dependency of the product's package.json must be a full commit of the
// core repo, reachable from its main. The core's scripts were approved in the core itself
// (its guard, owner's tests:allow, merge to main), so a second approval per product adds
// nothing; what the guard must catch is a pin to an unreviewed branch or fork.

// The guard runs inside git hooks (pre-commit), where GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE etc.
// point at the product's repository; without dropping them, `git -C <mirror>` would act on it.
// Only those repository-location variables go: credentials passed as GIT_CONFIG_COUNT/KEY/VALUE
// or GIT_ASKPASS (coding flow's gate) must stay, or the private core repo can't be fetched.
const repoVars = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES"
])
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !repoVars.has(k)))

export const coreUrl = "https://github.com/dyegorov/agent-core.git"
const pin =
  /^(?:git\+)?(?:https:\/\/github\.com\/|github:)dyegorov\/agent-core(?:\.git)?#([0-9a-f]{40})$/

// shortcut: the pin is read from package.json only (not from the installed copy or the
// lockfile); upgrade when a product can install the core from a commit it does not pin.
// shortcut: one shared mirror in the temp dir, refreshed by fetch; upgrade if tmp is wiped often.
export const coreProblems = (
  root: string,
  mainUrl = coreUrl,
  mirror = join(tmpdir(), "agent-core-main.git")
): ReadonlyArray<string> => {
  const file = join(root, "package.json")
  const pkg = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { readonly dependencies?: Record<string, string> })
    : {}
  const spec = pkg.dependencies?.["agent-core"]
  if (spec === undefined) return []
  const sha = pin.exec(spec)?.[1]
  if (sha === undefined)
    return [
      `agent-core: "${spec}" is not a full commit of ${coreUrl}; pin the core to a commit on its main`
    ]
  const git = (...args: ReadonlyArray<string>) =>
    execFileSync("git", args, { stdio: "pipe", timeout: 60_000, env: cleanEnv() })
  try {
    if (!existsSync(mirror)) git("init", "--bare", mirror)
    git("-C", mirror, "fetch", "--no-tags", mainUrl, "+main:refs/heads/main")
  } catch {
    // offline: a cached mirror can still prove it (a commit on main stays there)
  }
  try {
    git("-C", mirror, "merge-base", "--is-ancestor", sha, "main")
    return []
  } catch {
    return [`agent-core: cannot verify core commit ${sha} is on main of ${coreUrl}`]
  }
}
