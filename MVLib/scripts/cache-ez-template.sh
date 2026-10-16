#!/usr/bin/env bash
# Cache the source-based EZ-Template package as an archive built by this project.

set -Eeuo pipefail

readonly ARCHIVE_RELATIVE_PATH="firmware/libmvlib.a"
readonly SOURCE_RELATIVE_PATH="src/mvlib"

info() {
  printf '\033[32m[MVLib]\033[0m %s\n' "$*"
}

die() {
  printf '\033[31m[MVLib]\033[0m Error: %s\n' "$*" >&2
  exit 1
}

project_root="$PWD"
while [[ "$project_root" != "/" && ! -f "$project_root/project.pros" ]]; do
  project_root="$(dirname "$project_root")"
done

[[ -f "$project_root/project.pros" ]] || die "Run this command from a PROS project or one of its subdirectories."
[[ -f "$project_root/Makefile" ]] || die "The project does not contain a Makefile."
[[ -f "$project_root/common.mk" ]] || die "The project does not contain common.mk."
command -v pros >/dev/null 2>&1 || die "The PROS CLI must be available as 'pros'."

cd "$project_root"

source_dir="$project_root/$SOURCE_RELATIVE_PATH"
archive_path="$project_root/$ARCHIVE_RELATIVE_PATH"
temporary_archive_path="$archive_path.tmp"

if [[ ! -d "$source_dir" ]]; then
  [[ -s "$archive_path" ]] && {
    info "MVLib is already cached at $ARCHIVE_RELATIVE_PATH."
    exit 0
  }
  die "Could not find $SOURCE_RELATIVE_PATH. Apply libmvlib-ez-template before caching it."
fi

work_dir="$(mktemp -d "$project_root/.mvlib-cache.XXXXXX")"
build_rules="$(mktemp "${TMPDIR:-/tmp}/mvlib-cache.XXXXXX.mk")"
source_backup=""
archive_backup=""
source_moved=0
archive_replaced=0

cleanup() {
  local status=$?
  trap - EXIT
  set +e

  if (( status != 0 )); then
    if (( source_moved )) && [[ -d "$source_backup" && ! -e "$source_dir" ]]; then
      mv "$source_backup" "$source_dir"
      info "Restored $SOURCE_RELATIVE_PATH after the failed cache attempt."
    fi

    if (( archive_replaced )); then
      if [[ -f "$archive_backup" ]]; then
        mv -f "$archive_backup" "$archive_path"
        info "Restored the previous MVLib archive after the failed cache attempt."
      else
        rm -f "$archive_path"
        info "Removed the unverified MVLib archive after the failed cache attempt."
      fi
    fi
  fi

  rm -f "$build_rules"
  rm -f "$temporary_archive_path"
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup EXIT

if [[ -f "$archive_path" ]]; then
  archive_backup="$work_dir/libmvlib.a.previous"
  cp -p "$archive_path" "$archive_backup"
fi
rm -f "$temporary_archive_path"

cat >"$build_rules" <<'MAKEFILE'
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
MAKEFILE

info "Compiling MVLib with this project's PROS toolchain."
pros make --project "$project_root" -- -f Makefile -f "$build_rules" mvlib-cache

[[ -s "$temporary_archive_path" ]] || die "The compiler did not create $ARCHIVE_RELATIVE_PATH.tmp."
archive_replaced=1
mv -f "$temporary_archive_path" "$archive_path"

source_backup="$work_dir/mvlib-source"
mv "$source_dir" "$source_backup"
source_moved=1
rm -rf "$project_root/bin/mvlib" "$project_root/.d/mvlib"

info "Verifying an archive-only build."
pros make --project "$project_root" quick

[[ -s "$archive_path" ]] || die "$ARCHIVE_RELATIVE_PATH disappeared during verification."

info "Cached MVLib at $ARCHIVE_RELATIVE_PATH and removed $SOURCE_RELATIVE_PATH."
