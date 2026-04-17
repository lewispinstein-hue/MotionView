#pragma once

/**
 * @file okapi.hpp
 * @brief Optional Logger adapter for OkAPI odometry.
 */

#ifdef _MVLIB_OPTIONAL_USED
#error "More than one type of Logger/Optional include used!"
#endif // _MVLIB_OPTIONAL_USED

#ifndef _MVLIB_OPTIONAL_USED
#define _MVLIB_OPTIONAL_USED "okapi"
#include "mvlib/core.hpp" // IWYU pragma: keep
#include "okapi/api.h"    // IWYU pragma: keep

#include <optional>
namespace mvlib {
/**
 * @brief Attach an OkapiLib odometry getter to the Logger.
 *
 * This overload adapts OkapiLib's odometry state into mvlib's Pose so the Logger can
 * query a consistent pose regardless of which drivetrain stack you use.
 *
 * Typical OkapiLib setups expose pose through an odometry-capable chassis controller
 * (e.g., okapi::OdomChassisController) which provides getState() returning an
 * okapi::OdomState containing x, y, and theta.
 *
 * This adapter:
 * - Returns std::nullopt if the controller pointer is null.
 * - Otherwise reads the current odometry state and converts it into Pose.
 *
 * @note Unit conventions:
 * - OkapiLib commonly represents x and y as okapi::QLength and theta as okapi::QAngle.
 * - This implementation converts to **inches** for x/y and **degrees** for theta (matching the
 *   EZ-Template adapter we wrote and typical LemLib pose usage).
 *
 * If your downstream expects different units, pass a different `units` value
 * for x/y conversion, or use the generic custom odom overload and do your own
 * conversions.
 *
 * @warning If the Okapi odometry isn't configured/enabled, getState() may still return
 *          values, but they won't be meaningful. If you want a "ready" gate, add your own
 *          check and return std::nullopt until calibrated.
 *
 * @par Example
 * @code{.cpp}
 * // Suppose you built an Okapi odom chassis controller somewhere:
 * okapi::OdomChassisController odomChassis = okapi::ChassisControllerBuilder()
 *   .withMotors({1, 2}, {-3, -4})
 *   .withDimensions(okapi::AbstractMotor::gearset::green, {{4_in, 11.5_in}, okapi::imev5GreenTPR})
 *   .withOdometry()
 *   .buildOdometry();
 * void initialize() {
 *   mvlib::setOdom(&odomChassis);
 * }
 * @endcode
 */
inline void setOdom(okapi::OdomChassisController *chassis, 
                    okapi::QLength units = okapi::inch) {
  mvlib::Logger::getInstance().setPoseGetter([chassis, units]() -> std::optional<Pose> {
    if (!chassis) return std::nullopt;

    const auto s = chassis->getState();

    const float xIn   = s.x.convert(units);
    const float yIn   = s.y.convert(units);
    const float thDeg = s.theta.convert(okapi::deg);

    return Pose{xIn, yIn, thDeg};
  });
}
} // 
#endif // _MVLIB_OPTIONAL_USED
