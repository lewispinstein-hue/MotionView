#pragma once

// IWYU pragma: begin_keep
#include "core.hpp"
#include "logMacros.h"
#include "pros/motors.hpp"
#include "renderHelper.hpp"
#include "config.hpp"
#include "literals.hpp" 
#include "waypoint.hpp"
// IWYU pragma: end_keep

/*
 * Define MVLIB_USE_SIMPLES to use the _mvS and _mvMs operators, 
 * LogLevel::FOO instead of mvlib::LogLevel::FOO
*/
#ifdef MVLIB_USE_SIMPLES
using namespace mvlib::literals;
using LogLevel = mvlib::LogLevel;
#endif
