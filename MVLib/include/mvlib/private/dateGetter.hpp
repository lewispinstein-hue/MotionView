#pragma once

/**
 * @file dateGetter.hpp
 * @brief Internal MVLib helpers
 */

namespace mvlib {
namespace detail {
inline const char* getBuildDate() {
  return __DATE__;
}
} // namespace detail
} // namespace mvlib
