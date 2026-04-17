#pragma once
/**
 * @file api.hpp
 * @brief API Header for MVLib.
 *
 * @note Define MVLIB_USE_SIMPLES to use the time literals 
 *       (for disambiguation of .watch()) and to drop the namespace 
 *       from the mvlib::LogLevel enum.
 */

// IWYU pragma: begin_keep
#include "core.hpp"
#include "renderHelper.hpp"
#include "literals.hpp"
#include "waypoint.hpp"
#include "telemetry.hpp"
// IWYU pragma: end_keep

/*
 * Define MVLIB_USE_SIMPLES to use the _mvS and _mvMs operators, 
 * LogLevel::FOO instead of mvlib::LogLevel::FOO
*/
#ifdef MVLIB_USE_SIMPLES
using namespace mvlib::literals;
using LogLevel = mvlib::LogLevel;
#endif
