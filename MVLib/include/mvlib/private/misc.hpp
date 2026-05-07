#pragma once

/**
* @file misc.hpp
* @brief Internal MVLib helpers
*/

#include "mvlib/watches.hpp"

namespace mvlib {
namespace detail {
template<class>
inline constexpr bool always_false_v = false;

// Attribute for printf format checks
#if defined(__GNUC__) || defined(__clang__)
  #define _MVLIB_FORMAT_CHECK(fmt_idx, arg_idx) __attribute__((format(printf, fmt_idx, arg_idx)))
#else
  #define _MVLIB_FORMAT_CHECK(fmt_idx, arg_idx) 
#endif
} // namespace detail
} // namespace mvlib
