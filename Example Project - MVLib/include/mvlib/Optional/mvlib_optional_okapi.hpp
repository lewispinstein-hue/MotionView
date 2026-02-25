#pragma once

/**
 * @file logger_optional_okapi.hpp
 * @brief Optional Logger adapter for OkAPI odometry.
 */

#ifdef _MVLIB_OPTIONAL_USED
#error More than one type of Mvlib Optional include used!
#endif

#ifndef _MVLIB_OPTIONAL_USED
#define _MVLIB_OPTIONAL_USED
#include "mvlib/core.hpp" // IWYU pragma: keep
#include "okapi/api.hpp"     // IWYU pragma: keep

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
 * If your downstream expects different units, change the conversions (or call the generic
 * setOdom(logger, getterFn) overload and do your own conversions).
 *
 * @warning If the Okapi odometry isn't configured/enabled, getState() may still return
 *          values, but they won't be meaningful. If you want a "ready" gate, add your own
 *          check and return std::nullopt until calibrated.
 *
 * @par Example
 * @code{.cpp}
 * // Suppose you built an Okapi odom chassis controller somewhere:
 * std::shared_ptr<okapi::OdomChassisController> odomChassis = okapi::ChassisControllerBuilder()
 *   .withMotors({1, 2}, {-3, -4})
 *   .withDimensions(okapi::AbstractMotor::gearset::green, {{4_in, 11.5_in}, okapi::imev5GreenTPR})
 *   .withOdometry()
 *   .buildOdometry();
 *
 * mvlib::Logger logger;
 * mvlib::setOdom(logger, odomChassis.get());
 * @endcode
 */
inline void setOdom(Logger& logger, okapi::OdomChassisController* chassis) {
  logger.setPoseGetter([chassis]() -> std::optional<Pose> {
    if (!chassis) return std::nullopt;

    const auto s = chassis->getState();

    const double xIn   = s.x.convert(okapi::inch);
    const double yIn   = s.y.convert(okapi::inch);
    const double thDeg = s.theta.convert(okapi::degree);

    return Pose{
      xIn, 
      yIn, 
      thDeg};
  });
}
} // namespace mvlib
#endif
