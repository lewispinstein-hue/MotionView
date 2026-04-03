#pragma once
/**
 * @file literals.hpp
*/

#include <cstdint>

namespace mvlib {
namespace literals {

/**
 * @brief Operator for .watch() intervalMs. Allows number_mvMs 
 *        instead of uint32_t{number}
 *
 * \return Explicit uint32_t casted version of the input number
 *
 * \b Example
 * @code{.cpp}
 * logger.watch("foo", mvlib::LogLevel::INFO, 100_mvMs, ...);
 * @endcode
*/
constexpr uint32_t operator""_mvMs(unsigned long long int ms) {
    return static_cast<uint32_t>(ms);
}

/**
 * @brief Operator for .watch() intervalMs. Allows number_mvS 
 *        instead of uint32_t{number}, in seconds form
 *
 * \return Explicit uint32_t casted version of the input number, 
 *         times 1000.
 *
 * \b Example
 * @code{.cpp}
 * logger.watch("foo", mvlib::LogLevel::INFO, 1.7_mvS, ...);
 * @endcode
*/
constexpr uint32_t operator""_mvS(long double s) {
    return static_cast<uint32_t>(s * 1000);
}

/** 
 * @brief Overload for integer type. Same as mvlib::operator""_mvS, used for
 *        non-float literals.
 *
 * \b Example
 * @code{.cpp}
 * logger.watch("foo", mvlib::LogLevel::INFO, 1_mvS, ...);
 * @endcode
*/
constexpr uint32_t operator""_mvS(unsigned long long s) {
    return static_cast<uint32_t>(s * 1000);
}
} // namespace literals
} // namespace mvlib