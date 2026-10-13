################################################################################
######################### User configurable parameters #########################
# filename extensions
CEXTS:=c
ASMEXTS:=s S
CXXEXTS:=cpp c++ cc

# probably shouldn't modify these, but you may need them below
ROOT=.
FWDIR:=$(ROOT)/firmware
BINDIR=$(ROOT)/bin
SRCDIR=$(ROOT)/src
INCDIR=$(ROOT)/include

WARNFLAGS+=
EXTRA_CFLAGS += -fanalyzer
EXTRA_CXXFLAGS += -fanalyzer
EXTRA_CXXFLAGS += -Wno-analyzer-use-of-uninitialized-value

# Set to 1 to enable hot/cold linking
USE_PACKAGE:=1

# Add libraries you do not wish to include in the cold image here
# EXCLUDE_COLD_LIBRARIES:= $(FWDIR)/your_library.a
EXCLUDE_COLD_LIBRARIES:= 

# Set this to 1 to add additional rules to compile your project as a PROS library template
IS_LIBRARY:=1

CREATE_TEMPLATE_FLAGS += --kernels ">=4.2.1,<5.0.0"
LIBNAME:=libmvlib
VERSION:=3.0.1-alpha.0

# EXCLUDE_SRC_FROM_LIB= $(SRCDIR)/unpublishedfile.c
# this line excludes opcontrol.c and similar files
EXCLUDE_SRC_FROM_LIB+=$(foreach file, $(SRCDIR)/main,$(foreach cext,$(CEXTS),$(file).$(cext)) $(foreach cxxext,$(CXXEXTS),$(file).$(cxxext)))

# Headers installed by both precompiled-library templates.
TEMPLATE_FILES := $(shell find include/mvlib -type f \( -name "*.h" -o -name "*.hpp" \))
.DEFAULT_GOAL=quick

################################################################################
################################################################################
########## Nothing below this line should be edited by typical users ###########
-include ./common.mk

PROS ?= pros
EZ_TEMPLATE_NAME := libmvlib-ez-template
EZ_TEMPLATE_ZIP := $(ROOT)/$(EZ_TEMPLATE_NAME)@$(VERSION).zip
EZ_TEMPLATE_FILES := $(shell find include/mvlib src/mvlib -type f \( -name "*.h" -o -name "*.hpp" -o -name "*.cpp" \))

.PHONY: ez-template
ez-template:
	$(PROS) conductor create-template . $(EZ_TEMPLATE_NAME) $(VERSION) $(foreach file,$(EZ_TEMPLATE_FILES),--system "$(file)") --target v5 --kernels ">=4.1.1,<=4.2.2" --destination "$(EZ_TEMPLATE_ZIP)"

.PHONY: template
template:: ez-template
