#pragma once
/**
 * @file renderHelper.hpp
 * @brief Helper functions for rendering.
 *
*/

#include <string>
#include <cstdio>
#include <cstdint>

namespace mvlib {
/**
 * @brief Render a std::string as-is.
 * \return The rendered string.
 */
static std::string renderValue(const std::string& v) {
  return v; 
}

/**
 * @brief Render a C-string safely.
 * \return "(null)" if v is nullptr, otherwise v as std::string.
 */
static std::string renderValue(const char *v) {
  return v ? std::string(v) : std::string("(null)");
}

/**
 * @brief Render a boolean as "t"/"f". 
 * \return Rendered boolean string.
 */
static std::string renderValue(bool v) {
  return v ? "t" : "f";
}

template <class T>
static std::string renderValue(const T* v) {
  return v ? std::to_string((uintptr_t)v) : std::string("(null)");
}

/**
 * @brief Render arithmetic types.
 *
 * @tparam T Value type. 
 * @param v Value to render.
 * \return Rendered value string.
 *
 * @note Floating-point values are rendered with two decimal places.
 * @note Non-arithmetic types fall back to "<unrenderable>".
 */
template <class T>
static std::string renderValue(const T& v) {
  if constexpr (std::is_floating_point_v<T>) {
    char buf[256];
    snprintf(buf, sizeof(buf), "%.2f", (double)v);
    return std::string(buf);
  } else if constexpr (std::is_integral_v<T>) {
    return std::to_string((long long)v);
  } else return std::string("<unrenderable>");
}
} // namespace mvlib
