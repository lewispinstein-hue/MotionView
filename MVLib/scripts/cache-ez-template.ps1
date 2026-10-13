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
MVLIB_CACHE_ARCHIVE := $(FWDIR)/libmvlib.a
MVLIB_CACHE_TEMP_ARCHIVE := $(MVLIB_CACHE_ARCHIVE).tmp
MVLIB_CACHE_SOURCES := $(shell find "$(SRCDIR)/mvlib" -type f \( -name '*.c' -o -name '*.s' -o -name '*.S' -o -name '*.cpp' -o -name '*.c++' -o -name '*.cc' \) | sort)
MVLIB_CACHE_OBJECTS := $(sort $(addprefix $(BINDIR)/,$(patsubst $(SRCDIR)/%,%.o,$(MVLIB_CACHE_SOURCES))))

ifeq ($(strip $(MVLIB_CACHE_SOURCES)),)
$(error No compilable MVLib sources were found in $(SRCDIR)/mvlib)
endif

.PHONY: mvlib-cache
mvlib-cache: $(MVLIB_CACHE_OBJECTS)
	@mkdir -p "$(dir $(MVLIB_CACHE_ARCHIVE))"
	@rm -f "$(MVLIB_CACHE_TEMP_ARCHIVE)"
	$(AR) rcs "$(MVLIB_CACHE_TEMP_ARCHIVE)" $(MVLIB_CACHE_OBJECTS)
	@test -s "$(MVLIB_CACHE_TEMP_ARCHIVE)"
	@members="$$( $(AR) t "$(MVLIB_CACHE_TEMP_ARCHIVE)" | wc -l | tr -d '[:space:]' )"; \
		expected="$(words $(MVLIB_CACHE_OBJECTS))"; \
		test "$$members" -eq "$$expected"
	@mv -f "$(MVLIB_CACHE_TEMP_ARCHIVE)" "$(MVLIB_CACHE_ARCHIVE)"
'@

Push-Location $projectRoot
try {
    New-Item -ItemType Directory -Path $workDir | Out-Null
    [System.IO.File]::WriteAllText($buildRules, $makeRules, [System.Text.Encoding]::ASCII)

    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        $archiveBackup = Join-Path $workDir 'libmvlib.a.previous'
        Copy-Item -LiteralPath $archivePath -Destination $archiveBackup
    }

    Write-Info "Compiling MVLib with this project's PROS toolchain."
    & pros make --project $projectRoot -- -f Makefile -f $buildRules mvlib-cache
    if ($LASTEXITCODE -ne 0) {
        throw "The MVLib archive build failed with exit code $LASTEXITCODE."
    }
    $archiveReplaced = $true

    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf) -or (Get-Item -LiteralPath $archivePath).Length -eq 0) {
        throw "The compiler did not create $archiveRelativePath."
    }

    $sourceBackup = Join-Path $workDir 'mvlib-source'
    Move-Item -LiteralPath $sourceDir -Destination $sourceBackup
    $sourceMoved = $true
    Remove-Item -LiteralPath (Join-Path $projectRoot 'bin/mvlib'), (Join-Path $projectRoot '.d/mvlib') -Recurse -Force -ErrorAction SilentlyContinue

    Write-Info 'Verifying an archive-only build.'
    & pros make --project $projectRoot quick
    if ($LASTEXITCODE -ne 0) {
        throw "The archive-only verification build failed with exit code $LASTEXITCODE."
    }

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
    Remove-Item -LiteralPath $buildRules -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
    Pop-Location
}
