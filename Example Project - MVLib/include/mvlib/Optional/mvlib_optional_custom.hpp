#pragma once

/**
 * @file logger_optional_custom_odom.hpp
 * @brief Optional Logger adapter for any custom or unsupported odometry.
 */

#ifdef _MVLIB_OPTIONAL_USED
#error More than one type of Mvlib Optional include used!
#endif

#ifndef _MVLIB_OPTIONAL_USED
#define _MVLIB_OPTIONAL_USED
#include "mvlib/core.hpp" // IWYU pragma: keep

#include <optional>
#include <type_traits>
#include <utility>

namespace mvlib {

/**
 * @brief Attach an arbitrary pose/odometry getter to the Logger.
 *
 * This overload is the most flexible form of setOdom(). Instead of passing a specific
 * odometry provider (e.g., LemLib chassis or EZ-Template drive), the caller supplies any
 * callable object that returns a std::optional<Pose>.
 *
 * The callable is copied (or moved) into the Logger's internal callback. On each Logger
 * query, the callable is invoked and should return:
 * - std::nullopt when pose is unavailable / invalid / not initialized
 * - Pose{...} when pose is available
 *
 * @tparam Fn Any callable type such that Fn() returns std::optional<Pose>.
 * @param logger The Logger instance that will consume the pose getter.
 * @param poseGetter A callable that returns std::optional<Pose> on demand.
 *
 * @warning If your callable captures pointers/references, you are responsible for ensuring
 *          they remain valid for as long as the Logger might invoke the callback.
 *
 * @par Example: Custom odometry implementation
 * This example shows how to:
 * 1) Detect whether odometry is "ready"
 * 2) Convert sensor units into a consistent Pose
 * 3) Return std::nullopt while invalid/uninitialized
 *
 * @code{.cpp}
 * #include "mvlib/Optional/logger_optional_custom_odom.hpp"  
 * #include <cmath>
 * #include <optional>
 * 
 * // Custom / Unsupported odom
 * #include "mylib.hpp"
 *
 * 
 * void initialize() {
 *   auto& logger = mvlib::Logger::getInstance();
 *   mvlib::setOdom(logger, []() -> std::optional<mvlib::Pose> {
 *     if (!customOdomReady()) {
 *       // Odom not initialized yet; downstream should treat as "no pose available".
 *       return std::nullopt;
 *     }
 *
 *     const float x = myOdom.Pose().x;
 *     const float y = myOdom.Pose().y;
 *     const float theta = myOdom.Pose().theta;
 *
 *     // Return a valid pose
 *     return mvlib::Pose{x, y, theta};
 *   });
 * }
 * @endcode
 */
template <class Fn>
inline void setOdom(Logger& logger, Fn&& poseGetter)
  requires std::is_same_v<std::invoke_result_t<Fn&>, std::optional<Pose>> {
    auto getter = std::forward<Fn>(poseGetter);

    logger.setPoseGetter([getter = std::move(getter)]() mutable -> std::optional<Pose> {
    return getter();
  });
}
} // namespace mvlib
#endif

