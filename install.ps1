
param(
    [string]$Target = (Get-Location).Path,
    [switch]$DryRun,
    [switch]$SkipPrompt,
    [switch]$Update
)

$ErrorActionPreference = "Stop"
$Script:MC_VERSION = "2.1.0"

function Write-Step($msg) { Write-Host "[install] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[install] WARN: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[install] ERR: $msg" -ForegroundColor Red }

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($req in @(".claude\framework-manifest.json", ".claude\paths.json", "version.json")) {
    if (-not (Test-Path (Join-Path $Source $req))) {
        Write-Err "Source repo missing required file: $req"
        Write-Err "Run install.ps1 from the MC repo root, not a copy."
        exit 1
    }
}

$VersionFile = Get-Content (Join-Path $Source "version.json") -Raw | ConvertFrom-Json
if ($VersionFile.version -ne $Script:MC_VERSION) {
    Write-Warn "version.json reports $($VersionFile.version), script expects $Script:MC_VERSION - proceeding with $($VersionFile.version)"
    $Script:MC_VERSION = $VersionFile.version
}

Write-Step "MC $Script:MC_VERSION installer"
Write-Step "Source: $Source"
Write-Step "Target: $Target"
if ($DryRun)      { Write-Step "Mode:   DRY-RUN (no files written)" }
elseif ($Update)  { Write-Step "Mode:   UPDATE (delegate to /mc:update - fresh-copy path skipped)" }
else              { Write-Step "Mode:   FRESH-INSTALL" }

$ExistingInstall = Join-Path $Target ".claude\framework-installed.json"

if ($Update) {
    if (-not (Test-Path $ExistingInstall)) {
        Write-Err "-Update requires an existing MC install at $Target. Run install.ps1 without -Update for a fresh install first."
        exit 1
    }
    Write-Step ""
    Write-Step "/mc:update is the canonical update path - install.ps1 -Update no longer copies files."
    Write-Step "Open the project in Claude Code and run:"
    Write-Step "    /mc:update                     # dry-run"
    Write-Step "    /mc:update --apply             # apply"
    Write-Step ""
    Write-Step "Why: a fresh-copy under -Update silently overwrote local customizations."
    Write-Step "     /mc:update uses the 12-category classifier and respects mergeStrategy."
    exit 0
}

if (Test-Path $ExistingInstall) {
    $Existing = Get-Content $ExistingInstall -Raw | ConvertFrom-Json
    Write-Warn "Existing MC install detected: version=$($Existing.installedVersion) commit=$($Existing.installedCommit.Substring(0, [Math]::Min(8, $Existing.installedCommit.Length)))"
    if (-not $Update -and -not $SkipPrompt) {
        $resp = Read-Host "Continue with FRESH install (overwrites)? [y/N]"
        if ($resp -ne "y") {
            Write-Step "Aborted - use -Update to upgrade in-place"
            exit 0
        }
    }
}

$Manifest = Get-Content (Join-Path $Source ".claude\framework-manifest.json") -Raw | ConvertFrom-Json
$AssetCount = 0
foreach ($kind in $Manifest.assets.PSObject.Properties.Name) {
    $AssetCount += $Manifest.assets.$kind.Count
}
Write-Step "$AssetCount assets to install across $($Manifest.counts.PSObject.Properties.Count) kinds"

if ($DryRun) {
    Write-Step "DRY-RUN: would install $AssetCount assets to $Target"
    Write-Step "DRY-RUN: would write framework-installed.json at $Target\.claude\"
    Write-Step "DRY-RUN: complete. No files written."
    exit 0
}

Write-Step "Stage 1/3 - copying assets"
$Copied = 0
$Skipped = 0
$InstalledAssets = @()
foreach ($kind in $Manifest.assets.PSObject.Properties.Name) {
    foreach ($asset in $Manifest.assets.$kind) {
        $srcPath  = Join-Path $Source $asset.src
        $destPath = Join-Path $Target $asset.dest
        if (-not (Test-Path -LiteralPath $srcPath)) {
            Write-Warn "Source missing: $($asset.src) - skipped"
            $Skipped += 1
            continue
        }
        $destDir = Split-Path -Parent $destPath
        if (-not (Test-Path -LiteralPath $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $srcPath -Destination $destPath -Force
        $Copied += 1
        $hash = (Get-FileHash -LiteralPath $destPath -Algorithm SHA256).Hash.ToLower()
        $InstalledAssets += [ordered]@{
            id              = $asset.id
            kind            = $asset.kind
            dest            = $asset.dest
            owner           = $asset.owner
            mergeStrategy   = $asset.mergeStrategy
            installedHash   = $hash
            currentHashAtInstall = $hash
            introducedIn    = $asset.introducedIn
        }
    }
}
Write-Step "Stage 1/3 - copied $Copied, skipped $Skipped, hashed $($InstalledAssets.Count)"

Write-Step "Stage 2/3 - writing install snapshot"
$installRecord = [ordered]@{
    "`$schema"          = "mc/framework-installed/v2"
    installedVersion    = $Script:MC_VERSION
    installedCommit     = (git -C $Source rev-parse HEAD 2>$null)
    installedAt         = (Get-Date -Format "o")
    source              = $Source
    target              = $Target
    pathRegistryVersion = ($VersionFile.pathRegistrySchema -split '/')[-1]
    manifestSchema      = "mc/framework-manifest/v2"
    assets              = $InstalledAssets
    generated           = @(
        ".claude/paths.json",
        ".claude/manifest.json",
        ".claude/settings.json",
        ".claude/agents/store.json",
        ".claude/framework-installed.json"
    )
}
$installRecordJson = $installRecord | ConvertTo-Json -Depth 10
$installRecordPath = Join-Path $Target ".claude\framework-installed.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($installRecordPath, $installRecordJson, $utf8NoBom)
Write-Step "Stage 2/3 - snapshot at .claude\framework-installed.json (no BOM)"

$GeneratorPath = Join-Path $Target "scripts\generate-framework-manifest.js"
if (Test-Path -LiteralPath $GeneratorPath) {
    Push-Location $Target
    try {
        & node $GeneratorPath 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Step "Stage 2/3 - framework-manifest.json regenerated against $Target ($Script:MC_VERSION)"
        } else {
            Write-Warn "framework-manifest.json regenerator returned $LASTEXITCODE - falling back to canonical copy"
            Copy-Item -LiteralPath (Join-Path $Source ".claude\framework-manifest.json") -Destination (Join-Path $Target ".claude\framework-manifest.json") -Force
        }
    } finally {
        Pop-Location
    }
} else {
    $ManifestSrc = Join-Path $Source ".claude\framework-manifest.json"
    $ManifestDst = Join-Path $Target ".claude\framework-manifest.json"
    $ManifestDstDir = Split-Path -Parent $ManifestDst
    if (-not (Test-Path -LiteralPath $ManifestDstDir)) {
        New-Item -ItemType Directory -Path $ManifestDstDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $ManifestSrc -Destination $ManifestDst -Force
    Write-Step "Stage 2/3 - framework-manifest.json copied from canonical (no generator on target yet)"
}

$ScaffoldCore = Join-Path $Target "scripts/mc/scaffold-core.js"
if (Test-Path $ScaffoldCore) {
    Write-Step "Stage 2.5/3 - running shared product-scaffold core"
    & node $ScaffoldCore $Target --mc-root "$Source"
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "scaffold-core.js exited $LASTEXITCODE - product scaffold may be incomplete (paths.json/zones/ROADMAP/PROJECT.md/maps/_mc). Re-run /mc:setup from inside the project to complete it."
    } else {
        Write-Step "Stage 2.5/3 - product scaffold complete (paths.json, _requirements/_docs zones, ROADMAP, PROJECT.md, maps nudge, _mc/ mirror)"
        if (Test-Path -LiteralPath $GeneratorPath) {
            Push-Location $Target
            try {
                & node $GeneratorPath 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    Write-Step "Stage 2.5/3 - framework-manifest.json regenerated post-scaffold (counts scaffolded assets)"
                } else {
                    Write-Warn "post-scaffold framework-manifest regen returned $LASTEXITCODE"
                }
            } finally {
                Pop-Location
            }
        }
    }
} else {
    Write-Warn "scaffold-core.js not found at $ScaffoldCore - skipping product scaffold. The manifest may predate it; regenerate the framework manifest and re-run, or run /mc:setup from inside the project."
}

Write-Step "Stage 3/3 - install complete"
Write-Step "Next step: open the project in Claude Code; run /mc:health or /mc:doctor to verify."
if ($Update) {
    Write-Step "UPDATE mode: now run /mc:update --dry-run from inside the project to plan deltas."
}

$SprintSchemaDir = Join-Path $Target "schemas\sprint"
if (Test-Path $SprintSchemaDir) {
    Write-Step ""
    Write-Step "Sprint Workflow v0.1 is available in this install."
    Write-Step "To opt in: node scripts\sprint\init.js --project ""<your project>"""
    Write-Step "Then in Claude Code: /sprint:plan ""<brief plain-language request>"""
    Write-Step "Reference: paths.sprintReference (.claude\project\reference\sprint-workflow.md)"
    Write-Step "Reference: .claude\project\reference\sprint-workflow.md"
    Write-Step ""
    Write-Step "Existing /mode:solo, /mode:adhoc, /mode:oneshot keep working unchanged."
    Write-Step "Sprint is ADDITIVE - opt out by not running /sprint:* commands."
}

exit 0
