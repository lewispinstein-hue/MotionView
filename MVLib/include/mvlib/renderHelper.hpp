#pragma once
/**
 * @file renderHelper.hpp
 * @brief Helper functions for rendering.
 *
*/

#include <string>
#include <cstdio>

namespace mvlib {
/**
  * @brief Render a std::string as-is.
  * \return The rendered string.
  */
static std::string renderValue(const std::string& v, const std::string&) {
  return v; 
}

/**
  * @brief Render a C-string safely.
  * \return "(null)" if v is nullptr, otherwise v as std::string.
  */
static std::string renderValue(const char *v, const std::string&) {
  return v ? std::string(v) : std::string("(null)");
}

/**
  * @brief Render a boolean as "t"/"f".
  * \return Rendered boolean string.
  */
static std::string renderValue(bool v, const std::string&) { return v ? "t" : "f"; }

/**
  * @brief Render arithmetic types using an optional printf-style format.
  *
  * @tparam T Value type.
  * @param v Value to render.
  * @param fmt Optional printf-style format string.
  * \return Rendered value string.
  *
  * @note Non-arithmetic types fall back to "<unrenderable>".
  */
template <class T>
static std::string renderValue(const T& v, const std::string& fmt) {
  if constexpr (std::is_floating_point_v<T>) {
    if (!fmt.empty()) {
      char buf[256];
      snprintf(buf, sizeof(buf), fmt.c_str(), (double)v);
      return std::string(buf);
    }
    return std::to_string((double)v);
  } else if constexpr (std::is_integral_v<T>) {
    (void)fmt; // ignore fmt for integrals
    return std::to_string((long long)v);
  } else return std::string("<unrenderable>");
}
} // namespace mvlib
