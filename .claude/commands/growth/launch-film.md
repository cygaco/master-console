---
description: Scaffold a code-driven launch-film project in the user's own video folder (Remotion renderer, ffmpeg assembly, free-licence audio options) and walk render, encode and delivery. Workflow only; no paid generators without approval.
---

# /growth:launch-film — Launch Film Workflow

Set up and run a code-driven video project: scaffold, render, assemble, encode, deliver. This skill is
**workflow only**. It carries no creative direction; what the film says and how it looks is the user's call.

The paid sibling is **`/growth:ad-video`** (generated video ads through a paid API). This skill makes no
paid calls.

> **Remotion is never a product dependency.** It is installed into the video folder the user chooses,
> never into the product's own repository (Step 1 enforces that). See ADR-0043.

## Input

`$ARGUMENTS` — optional: the path of the video folder. If absent, ask for it.

## Procedure

### Step 1: Choose the video folder (the only gate)

1. Ask the user where the video project should live.
2. **Check where the folder lives.** This protects the framework's own dependencies: the renderer must
   never become one of them. Run `git -C <folder> rev-parse --show-toplevel` and compare the result with the
   framework's root folder; for a folder that does not exist yet, run it on the nearest existing parent.
   - Same root (inside the framework's own repository): **STOP** and ask for another folder.
   - Anywhere else: suggest a separate folder so Remotion stays out of the user's app dependencies
     (advice, not policy). The user decides.
3. Before installing anything, state the renderer licence. The scaffold pins Remotion 4.0.536, and this
   wording covers that version. Remotion is free for individuals, for for-profit organisations with up to
   3 people, for non-profits, and for evaluators not yet using it commercially. A Company License is
   required for everyone else (for-profit organisations with a combined headcount of 4 or more).
   The licence changes in Remotion 5.0 (`LICENSE.md` line 3).
   Licence terms: https://www.remotion.dev/docs/license/terms
   Accessed 2026-10-31. Re-check the page before relying on it; terms can change.
4. No further confirmation is needed beyond the folder choice. Do not download anything outside it.

Prerequisites on PATH: Node, `ffmpeg` and `ffprobe`, and a bash shell (Git Bash on Windows). The renderer
downloads its own headless browser into the video folder on first render.

### Step 2: Scaffold

Never overwrite the user's files. Before writing anything, list which of the files below, and `package-lock.json` or `node_modules/` (the install step rewrites them), already exist in
the folder. If any do, **STOP**: show the list and ask whether to use a new empty folder instead; never
write over an existing file, and never merge into an existing project without the user's explicit yes for
each file.

Layout:

```
<video-folder>/
  package.json  tsconfig.json  remotion.config.ts  .gitignore
  src/      index.ts  Root.tsx  Main.tsx  (one folder per scene as the film grows)
  public/   static assets (audio, fonts, images)
  out/      render output (gitignored)
  tools/    assemble.sh  release.sh
  CREDITS.md
```

`package.json` — every `remotion` and `@remotion/*` entry on ONE identical, exact version (no `^`, no `~`):

```json
{
  "name": "launch-film",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "studio": "remotion studio src/index.ts",
    "still": "remotion still src/index.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "remotion": "4.0.536",
    "@remotion/cli": "4.0.536",
    "@remotion/media": "4.0.536",
    "@remotion/media-utils": "4.0.536",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "jsfxr": "1.4.1",
    "@fontsource/jetbrains-mono": "5.3.0"
  },
  "devDependencies": {
    "@types/react": "18.3.12",
    "typescript": "5.9.3"
  }
}
```

Notes: self-hosted `@fontsource/*` fonts keep renders deterministic and offline; swap the font for the
user's choice. TypeScript is for typechecking only (`noEmit`); the renderer bundles the code itself.
`jsfxr` is only needed if the user picks it in Step 5. Run `npm install` in the video folder.

After the install, read `node_modules/remotion/LICENSE.md`; it governs this install.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "lib": ["DOM", "ES2022"]
  },
  "include": ["src"]
}
```

`remotion.config.ts`:

```ts
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
```

`src/index.ts` (entry):

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);
```

`src/Root.tsx` (composition registration; 1920x1080 at 30 fps):

```tsx
import { Composition } from "remotion";
import { Main } from "./Main";

export const RemotionRoot = () => (
  <Composition
    id="Main"
    component={Main}
    durationInFrames={300}
    fps={30}
    width={1920}
    height={1080}
  />
);
```

`src/Main.tsx` (placeholder so the scaffold renders as pasted; the user's film grows from it scene by scene):

```tsx
import { AbsoluteFill } from "remotion";

export const Main = () => <AbsoluteFill style={{ backgroundColor: "#111111" }} />;
```

`.gitignore`: `node_modules/` and `out/`.

### Step 3: Render

1. Preview while building: `npm run studio`.
2. **Render stills first** as a technical check for render errors, framing and missing assets (not a
   content review): `npx remotion still src/index.ts Main out/check.png --frame=0`, repeating with other
   `--frame=<n>` values. Stills are cheap; videos are not.
3. Then render video:

```
npx remotion render src/index.ts Main out/main.mp4 --gl=angle --crf=16 --codec=h264 --pixel-format=yuv420p
```

   - `--gl=angle`: needed for WebGL content, and the reliable choice on Windows where the default GL
     backend can fail to initialise. Drop it if the composition uses no WebGL and renders fine without.
   - `--crf=16` keeps scene renders at intermediate quality; the final encode in Step 4 sets delivery quality.
   - `--codec=h264` and `--pixel-format=yuv420p` give the widest player compatibility.
   - Concurrency: do not set it by default. If renders exhaust memory, add `--concurrency=<n>` and lower it.
4. Render each scene to its own MP4 in `out/`. Re-cutting then means editing the parts list and re-running
   assembly (seconds), not re-rendering.

### Step 4: Assemble and encode

`tools/assemble.sh` joins clips (optionally trimmed), adds an optional score, normalises loudness in two
passes and encodes the master. Run it from the video folder: `bash tools/assemble.sh parts.txt`.

Parts list (`parts.txt`): one clip per line as `file|trimStart|trimEnd` (seconds; empty trim = whole clip),
plus optional `out=<name>.mp4` and `score=<wav>` lines; `#` starts a comment. Paths are relative to `out/`. The script
rejects anything else: trim values must be non-negative decimals with end greater than start, clip and
score paths must be relative paths inside `out/`, and `out=` must be a plain file name (no `/`, `\`, `..` or
drive letter) that is not an existing symlink.

```bash
#!/usr/bin/env bash
set -euo pipefail
die(){ echo "error: $*" >&2; exit 1; }
num(){ [[ "$1" =~ ^[0-9]+([.][0-9]+)?$ ]]; }                                   # non-negative decimal
base(){ [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] && [[ "$1" != *..* ]]; }     # plain file name: no / \ : .. or leading - .
rel(){ [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$ ]] && [[ "$1" != *..* ]]; }  # relative path inside out/
LIST="$(cd "$(dirname "${1:?usage: assemble.sh <parts-list> [no-score]}")" && pwd)/$(basename "$1")"
VID="$(cd "$(dirname "$0")/.." && pwd -P)"                                  # canonical video folder
cd "$VID/out" 2>/dev/null || die "missing out/ folder in $VID"
[ "$(pwd -P)" = "$VID/out" ] || die "out/ does not resolve inside the video folder (symlink or junction?); refusing"
[ ! -L "$VID/out" ] || die "refusing a symlinked out/"
OUT="film.mp4"; SCORE="audio/score.wav"
[ "${2:-}" = "no-score" ] && SCORE=""
inputs=(); filt=""; n=0
while IFS= read -r line; do
  line="$(printf '%s' "$line" | tr -d '\r')"
  case "$line" in
    ""|\#*) continue;;
    out=*) OUT="${line#out=}"; continue;;
    score=*) SCORE="${line#score=}"; continue;;
  esac
  IFS='|' read -r f ts te extra <<<"$line"
  [ -z "${extra:-}" ] || die "too many fields: $line"
  rel "$f" || die "clip must be a relative path inside out/ (no .., no absolute path): $f"
  [ -f "$f" ] || die "missing clip: $f"
  inputs+=(-i "$f")
  v="[$n:v]fps=30,format=yuv420p,setsar=1"; a="aresample=48000,aformat=channel_layouts=stereo"
  if [ -n "${ts:-}${te:-}" ]; then
    { num "${ts:-}" && num "${te:-}"; } || die "trim values must be non-negative decimals: $line"
    awk -v ts="$ts" -v te="$te" 'BEGIN{exit !(te>ts)}' || die "trimEnd must be greater than trimStart: $line"
    v="$v,trim=$ts:$te,setpts=PTS-STARTPTS"; a="$a,atrim=$ts:$te,asetpts=PTS-STARTPTS"
    dur=$(awk -v ts="$ts" -v te="$te" 'BEGIN{print te-ts}')
  else
    # duration from the VIDEO stream: container duration can include an audio tail and drift sync
    frames=$(ffprobe -v error -count_packets -select_streams v:0 -show_entries stream=nb_read_packets -of csv=p=0 "$f")
    num "$frames" || die "could not read the frame count of $f"
    dur=$(awk -v n="$frames" 'BEGIN{print n/30}')
  fi
  if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$f" | grep -q .; then
    a="[$n:a]$a,apad,atrim=0:$dur"
  else
    a="anullsrc=r=48000:cl=stereo,atrim=0:$dur"   # clip has no audio stream
  fi
  filt="$filt$v[v$n];$a[a$n];"; n=$((n+1))
done < "$LIST"
[ "$n" -gt 0 ] || die "parts list has no clips"
# output and score names are validated before anything is written or ffmpeg runs with -y
{ base "$OUT" && [[ "$OUT" == *.mp4 ]]; } || die "out= must be a plain .mp4 file name, written inside out/: $OUT"
[ ! -L "$OUT" ] || die "refusing to write through a symlink: $OUT"
if [ -n "$SCORE" ]; then rel "$SCORE" || die "score= must be a relative path inside out/: $SCORE"; fi
cat_in=""; for ((i=0;i<n;i++)); do cat_in="$cat_in[v$i][a$i]"; done
filt="$filt${cat_in}concat=n=$n:v=1:a=1[v][sfx]"
amap="[sfx]"
if [ -n "$SCORE" ] && [ -f "$SCORE" ]; then
  inputs+=(-i "$SCORE")
  filt="$filt;[$n:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.9[sc];[sfx][sc]amix=inputs=2:normalize=0:duration=first[mix]"
  amap="[mix]"
fi
T="I=-13.7:TP=-2.0:LRA=11"
# pass 1: measure ([v]nullsink consumes the video label so the graph is complete)
m=$(ffmpeg -hide_banner -nostdin "${inputs[@]}" -filter_complex "$filt;[v]nullsink;${amap}loudnorm=$T:print_format=json[o]" -map "[o]" -f null - 2>&1 | tr -d '\r' | sed -n '/^{/,/^}/p')
g(){ printf '%s' "$m" | grep "\"$1\"" | sed 's/[^0-9.-]*\(-\?[0-9.]*\).*/\1/'; }
[ -n "$(g input_i)" ] || die "loudness measurement failed"
# pass 2: apply, limit, encode the master
ffmpeg -hide_banner -nostdin -y "${inputs[@]}" -filter_complex "$filt;${amap}loudnorm=$T:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,alimiter=limit=0.7:attack=1:release=50:level=false,aresample=48000[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT"
```

Very long parts lists can exceed the Windows command-line length limit; if so, write the filter graph to a
file and pass `-/filter_complex <file>` (ffmpeg 7 and newer; older builds used `-filter_complex_script`). The script is a starting point: run it once on two short clips and
check the output before relying on it.

**Delivery copies.** `bash tools/release.sh <master.mp4> <out-dir> <name> <capBytes> <audioK> <maxVideoK>`
encodes a size-capped 720p copy. Master, out-dir and name are all relative to `out/`: the master is a
relative path; out-dir and name are plain names (no `/`, `\`, `..` or drive letter). Bitrate, not resolution,
sets file size.

Encoding rule: total bitrate ≈ cap × 8 / duration; target video bitrate ≈ cap × 8 / duration − audio bitrate, with a margin. Check your channel's current limit, then compute. The script then checks the real size: if the copy is over the cap it re-encodes once at the video bitrate scaled by (cap / actual size) × 0.95, and if it is still over it stops with an error naming the file, its size and the cap. A copy over the cap is never left under the final name.

```bash
#!/usr/bin/env bash
set -euo pipefail
die(){ echo "error: $*" >&2; exit 1; }
int(){ [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 0 ]; }
base(){ [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] && [[ "$1" != *..* ]]; }     # plain name: no / \ : .. or leading -
rel(){ [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$ ]] && [[ "$1" != *..* ]]; }
[ $# -eq 6 ] || die "usage: release.sh <master.mp4> <out-dir> <name> <capBytes> <audioK> <maxVideoK>"
src="$1"; dir="$2"; name="$3"; cap="$4"; ak="$5"; maxk="$6"
VID="$(cd "$(dirname "$0")/.." && pwd -P)"                                  # canonical video folder
cd "$VID/out" 2>/dev/null || die "missing out/ folder in $VID"
[ "$(pwd -P)" = "$VID/out" ] || die "out/ does not resolve inside the video folder (symlink or junction?); refusing"
[ ! -L "$VID/out" ] || die "refusing a symlinked out/"
rel "$src" || die "master must be a relative path inside out/: $src"
[ -f "$src" ] || die "missing master: $src"
base "$dir" || die "out-dir must be a plain folder name inside out/: $dir"
base "$name" || die "name must be a plain file name: $name"
{ int "$cap" && int "$ak" && int "$maxk"; } || die "capBytes, audioK and maxVideoK must be positive integers"
[ ! -L "$dir" ] || die "refusing to use a symlink as out-dir: $dir"
{ [ ! -e "$dir" ] || [ -d "$dir" ]; } || die "out-dir exists and is not a folder: $dir"
[ ! -L "$dir/$name.mp4" ] || die "refusing to write through a symlink: $dir/$name.mp4"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
[[ "$dur" =~ ^[0-9]+([.][0-9]+)?$ ]] || die "could not read the duration of $src"
vk=$(awk -v c="$cap" -v d="$dur" -v a="$ak" -v m="$maxk" 'BEGIN{v=int(c*8/1000/d*0.97-a); if(v>m)v=m; print v}')
[ "$vk" -gt 0 ] || die "the size cap leaves no room for video at this duration and audio bitrate"
mkdir -p "$dir"
work="$(mktemp -d "$dir/.pass.XXXXXX")"     # fresh folder created by mktemp: pass logs never follow an existing link
trap 'rm -rf "$work"' EXIT
# pass 1 writes no file: '-f null -' works on every OS (a literal NUL path creates a real file on POSIX)
# encode into the private work folder; only a copy that meets the cap is moved to the final name
enc(){
  ffmpeg -y -nostdin -i "$src" -vf "scale=1280:720:flags=lanczos" -c:v libx264 -preset slow -b:v "${1}k" -pass 1 -passlogfile "$work/pass" -an -f null -
  ffmpeg -y -nostdin -i "$src" -vf "scale=1280:720:flags=lanczos" -c:v libx264 -preset slow -b:v "${1}k" -pass 2 -passlogfile "$work/pass" -pix_fmt yuv420p -c:a aac -ar 48000 -b:a "${ak}k" -movflags +faststart "$work/out.mp4"
  size=$(wc -c < "$work/out.mp4" | tr -d '[:space:]')
}
enc "$vk"
if [ "$size" -gt "$cap" ]; then      # over the cap: one retry at the video bitrate scaled by cap/actual x 0.95
  vk2=$(awk -v v="$vk" -v c="$cap" -v s="$size" 'BEGIN{print int(v*c/s*0.95)}')
  [ "$vk2" -gt 0 ] || die "$dir/$name.mp4 is $size bytes, over the $cap byte cap, and no video bitrate is left for a retry"
  echo "over cap ($size > $cap bytes): re-encoding once at ${vk2}k video" >&2
  enc "$vk2"
fi
[ "$size" -le "$cap" ] || die "$dir/$name.mp4 is $size bytes after the retry, over the $cap byte cap; nothing was written under that name"
mv -f "$work/out.mp4" "$dir/$name.mp4"
ls -la "$dir/$name.mp4"
```

Web copy (no size cap): `ffmpeg -i master.mp4 -c:v libx264 -preset slow -b:v 6000k -maxrate 7500k -bufsize 12000k -pix_fmt yuv420p -c:a aac -b:a 160k -ar 48000 -movflags +faststart web.mp4`.

Delivery size table:

| Copy | Encode settings | Size cap | Source |
|---|---|---|---|
| Master | 1080p, crf 18 | none of ours; the platform's upload limit applies | check the platform |
| Web / self-host | 1080p, about 6 Mbps (maxrate 7.5M) | none | n/a |
| GitHub issue / pull request / comment video attachment | 720p two-pass, about 600k video + 64k audio | 10 MB when the repository is on a free GitHub plan, 100 MB on a paid plan | docs.github.com, Attaching files page, accessed 2026-10-31 |

### Step 5: Asset sourcing (options, not a required palette)

Offer these; the user picks. Record every asset's source URL and licence in `CREDITS.md` in the video folder.

- **Music generated in code.** A Node script that synthesises a WAV (oscillators, filters, envelopes) and
  writes it to `out/audio/score.wav`. A production method with no licence questions; re-render the audio
  when the timing changes instead of re-editing.
- **jsfxr** (npm) for 8-bit sound effects. Licence: The Unlicense (public domain).
- **Kenney packs** (kenney.nl). Licence: CC0. The Kenney logo is reserved and is not covered. Keep each
  pack's licence file next to its files (for example under `public/sfx/`).
- **Mixkit** items whose page shows the Free licence only (https://mixkit.co/license/, https://mixkit.co/llm-info/,
  https://mixkit.co/free-sound-effects/). Check and record each item's licence; do not
  assume terms. Items under a Restricted licence are non-commercial and must not be used.
- **Paid generators** (music, sound or voice APIs): only with explicit user approval. They cost money and
  need accounts; never sign up or spend on the user's behalf.

Everything downloaded stays inside the video folder. Re-check each licence page at download time.

### Step 6: Delivery

The rendered video is large. Keep `out/` and any `.mp4` out of git history (the scaffold gitignores `out/`).
Attach or upload the right copy where the target platform expects it (see the size table); for a
repository, use that host's release or attachment mechanism rather than committing the file.

## Out of scope

Creative direction, scripts, storyboards and review passes; paid video generation (use `/growth:ad-video`).

## Related

`_guides/LAUNCH_FILM_GUIDE.md` (tool-agnostic version with the dated fact-check table);
ADR-0043.
