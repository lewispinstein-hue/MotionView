#pragma once

/**
 * @file lemlib.hpp
 * @brief Optional Logger adapter for LemLib odometry.
 */

#ifdef _MVLIB_OPTIONAL_USED
#error "More than one type of Logger/Optional include used!"
#endif // _MVLIB_OPTIONAL_USED

#ifndef _MVLIB_OPTIONAL_USED
#define _MVLIB_OPTIONAL_USED "lemlib"
#include "mvlib/core.hpp" // IWYU pragma: keep
/* 
 * Depending on your version of LemLib, this include might be outdated.
 * If lemlib/api.hpp is not found, it is likely this instead:
 * lemlib/lemlib.hpp
*/
#include "lemlib/api.hpp"  // IWYU pragma: keep
namespace mvlib {

/**
 * @brief Attach LemLib odometry to the Logger.
 *
 * Binds a pose getter that reads from lemlib::Chassis::getPose() and
 * forwards the values into mvlib::Pose. If the chassis pointer is null,
 * the getter returns std::nullopt.
 *
 * @param chassis Pointer to the LemLib chassis supplying pose data.
 *
 * @warning The caller must ensure the chassis pointer remains valid for
 *          as long as the Logger might invoke the callback.
 *
 * @par Example: LemLib odometry
 * @code{.cpp}
 * #include "mvlib/api.hpp"
 * #include "mvlib/Optional/lemlib.hpp"
 *
 * // Provided by your LemLib setup.
 * extern lemlib::Chassis chassis;
 *
 * void initialize() {
 *   auto& logger = mvlib::Logger::getInstance();
 *   mvlib::setOdom(&chassis);
 *   logger.start();
 * }
 * @endcode
 */
inline void setOdom(lemlib::Chassis *chassis) {
  mvlib::Logger::getInstance().setPoseGetter([chassis]() -> std::optional<Pose> {
    if (!chassis) return std::nullopt;
    auto p = chassis->getPose();
    return Pose{p.x, p.y, p.theta};
  });
}
} // namespace mvlib
#endif // _MVLIB_OPTIONAL_USED
