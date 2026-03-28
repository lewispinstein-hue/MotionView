#pragma once

/**
 * @file config.hpp
 * @brief Configuration file for MVLib. The constants in this file
 *        are meant to be changed by the user. 
 *
*/

#include <cstdint> // IWYU pragma: keep
#include "literals.hpp"

namespace mvlib {
#define __MVLIB_CONFIGURABLE static constexpr auto

namespace detail {
using namespace mvlib::literals;
/**
 * @brief SD file flush interval. At 1s (default), 
 *        SD card flushes out of RAM every 1 second.
*/
__MVLIB_CONFIGURABLE sd_flush = 1_mvS;

/**
 * @brief Controls how often mvlib polls for new data and logs it. Default: 120ms
 *         
 *
 * @note Time is in ms
 * @note This interval overrides the sd card interval. If logging to 
 *       terminal and to sd card, the terminal polling rate is used.
 *
 * @warning If the polling rate is too fast, it may overwhelm the 
 *          brain -> controller connection, which may cause the
 *          connection to be completely dropped and cease logging 
 *          or transmission lag.
*/
__MVLIB_CONFIGURABLE terminal_polling_rate = 120_mvMs;

/**
 * @brief Controls how often mvlib polls for new data and logs it. Default: 80ms
 * 
 * @note Time is in ms
 * @note Sd card output is buffered by SD_FLUSH_INTERVAL_MS. This only 
 *       controls how often that buffer is written too. Faster polling
 *       rates may lead to resource starvation of other tasks.
*/
__MVLIB_CONFIGURABLE sd_polling_rate = 80_mvMs;
}

extern const uint32_t SD_FLUSH_INTERVAL_MS;
extern const uint32_t TERMINAL_POLLING_RATE_MS;
extern const uint32_t SD_POLLING_RATE_MS;
} // namespace mvlib
