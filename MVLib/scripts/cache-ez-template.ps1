#Requires -Version 5.1

# Cache the source-based EZ-Template package as an archive built by this project.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$archiveRelativePath = 'firmware/libmvlib.a'
$sourceRelativePath = 'src/mvlib'

function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)

    Write-Host '[MVLib]' -NoNewline -ForegroundColor Green
    Write-Host " $Message"
}

function Fail {
    param([Parameter(Mandatory = $true)][string]$Message)

    Write-Host '[MVLib]' -NoNewline -ForegroundColor Red
    Write-Host " Error: $Message"
    throw $Message
}

function Invoke-ProsMake {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureSummary
    )

    $output = @(& pros @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }

    if ($exitCode -ne 0) {
        $diagnostic = ($output | Select-Object -Last 40 | Out-String).Trim()
        throw "$FailureSummary with exit code $exitCode.`nLast PROS output:`n$diagnostic"
    }
}

$projectRoot = (Get-Location).Path
while (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'project.pros') -PathType Leaf)) {
    $parent = Split-Path -LiteralPath $projectRoot -Parent
    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $projectRoot) {
        Fail 'Run this command from a PROS project or one of its subdirectories.'
    }
    $projectRoot = $parent
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'Makefile') -PathType Leaf)) {
    Fail 'The project does not contain a Makefile.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'common.mk') -PathType Leaf)) {
    Fail 'The project does not contain common.mk.'
}

$prosCommand = Get-Command pros -ErrorAction SilentlyContinue
if ($null -eq $prosCommand) {
    Fail "The PROS CLI must be available as 'pros'."
}

$sourceDir = Join-Path $projectRoot $sourceRelativePath
$archivePath = Join-Path $projectRoot $archiveRelativePath
$temporaryArchivePath = "$archivePath.tmp"

if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) {
    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        if ((Get-Item -LiteralPath $archivePath).Length -gt 0) {
            Write-Info "MVLib is already cached at $archiveRelativePath."
            return
        }
    }
    Fail "Could not find $sourceRelativePath. Apply libmvlib-ez-template before caching it."
}

$workDir = Join-Path $projectRoot ('.mvlib-cache.' + [guid]::NewGuid().ToString('N'))
$buildRules = Join-Path ([System.IO.Path]::GetTempPath()) ('mvlib-cache.' + [guid]::NewGuid().ToString('N') + '.mk')
$sourceBackup = $null
$archiveBackup = $null
$sourceMoved = $false
$archiveReplaced = $false

$makeRules = @'
MVLIB_CACHE_ARCHIVE := $(FWDIR)/libmvlib.a.tmp
mvlib_rwildcard = $(foreach path,$(wildcard $(1)/*),$(call mvlib_rwildcard,$(path),$(2)) $(filter $(subst *,%,$(2)),$(path)))
MVLIB_CACHE_SOURCES := $(sort $(call mvlib_rwildcard,$(SRCDIR)/mvlib,*.c) $(call mvlib_rwildcard,$(SRCDIR)/mvlib,*.s) $(call mvlib_rwildcard,$(SRCDIR)/mvlib,*.S) $(call mvlib_rwildcard,$(SRCDIR)/mvlib,*.cpp) $(call mvlib_rwildcard,$(SRCDIR)/mvlib,*.c++) $(call mvlib_rwildcard,$(SRCDIR)/mvlib,*.cc))
MVLIB_CACHE_OBJECTS := $(addprefix $(BINDIR)/,$(patsubst $(SRCDIR)/%,%.o,$(MVLIB_CACHE_SOURCES)))

ifeq ($(strip $(MVLIB_CACHE_SOURCES)),)
$(error No compilable MVLib sources were found in $(SRCDIR)/mvlib)
endif

.PHONY: mvlib-cache
mvlib-cache: $(MVLIB_CACHE_OBJECTS)
	$(AR) rcs "$(MVLIB_CACHE_ARCHIVE)" $(MVLIB_CACHE_OBJECTS)
'@

Push-Location $projectRoot
try {
    New-Item -ItemType Directory -Path $workDir | Out-Null
    [System.IO.File]::WriteAllText($buildRules, $makeRules, [System.Text.Encoding]::ASCII)

    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        $archiveBackup = Join-Path $workDir 'libmvlib.a.previous'
        Copy-Item -LiteralPath $archivePath -Destination $archiveBackup
    }
    Remove-Item -LiteralPath $temporaryArchivePath -Force -ErrorAction SilentlyContinue

    Write-Info "Compiling MVLib with this project's PROS toolchain."
    Invoke-ProsMake -Arguments @('make', '--project', $projectRoot, '--', '-f', 'Makefile', '-f', $buildRules, 'mvlib-cache') -FailureSummary 'The MVLib archive build failed'

    if (-not (Test-Path -LiteralPath $temporaryArchivePath -PathType Leaf) -or (Get-Item -LiteralPath $temporaryArchivePath).Length -eq 0) {
        throw "The compiler did not create $archiveRelativePath.tmp."
    }
    $archiveReplaced = $true
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $temporaryArchivePath -Destination $archivePath

    $sourceBackup = Join-Path $workDir 'mvlib-source'
    Move-Item -LiteralPath $sourceDir -Destination $sourceBackup
    $sourceMoved = $true
    Remove-Item -LiteralPath (Join-Path $projectRoot 'bin/mvlib'), (Join-Path $projectRoot '.d/mvlib') -Recurse -Force -ErrorAction SilentlyContinue

    Write-Info 'Verifying an archive-only build.'
    Invoke-ProsMake -Arguments @('make', '--project', $projectRoot, 'quick') -FailureSummary 'The archive-only verification build failed'

    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf) -or (Get-Item -LiteralPath $archivePath).Length -eq 0) {
        throw "$archiveRelativePath disappeared during verification."
    }

    Write-Info "Cached MVLib at $archiveRelativePath and removed $sourceRelativePath."
}
catch {
    if ($sourceMoved -and (Test-Path -LiteralPath $sourceBackup -PathType Container) -and -not (Test-Path -LiteralPath $sourceDir)) {
        Move-Item -LiteralPath $sourceBackup -Destination $sourceDir
        Write-Info "Restored $sourceRelativePath after the failed cache attempt."
    }

    if ($archiveReplaced) {
        if ($null -ne $archiveBackup -and (Test-Path -LiteralPath $archiveBackup -PathType Leaf)) {
            Copy-Item -LiteralPath $archiveBackup -Destination $archivePath -Force
            Write-Info 'Restored the previous MVLib archive after the failed cache attempt.'
        }
        else {
            Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
            Write-Info 'Removed the unverified MVLib archive after the failed cache attempt.'
        }
    }

    throw
}
finally {
    Remove-Item -LiteralPath $temporaryArchivePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $buildRules -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
    Pop-Location
}
