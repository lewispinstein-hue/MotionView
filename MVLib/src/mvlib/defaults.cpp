#include "mvlib/core.hpp"
#define _MVLIB_PREVENT_MACRO_CLEANUP
#include "mvlib/private/forwardLogMacros.h"
#include "pros/misc.hpp"
#include "pros/rtos.hpp"
#include <cstdint>

namespace mvlib {
bool Logger::setDefaultWatches(const DefaultWatches watches) {
  DefaultWatches w = watches;
  bool retval = true;
  if (!m_configSet || !configValid()) {
    _MVLIB_FORWARD_WARN("Drivetrain watches could not be set because config is not "
                        "set or invalid! Did you make sure to set config before default "
                        "watches?");
    w.leftDrivetrainWatchdog = false;
    w.rightDrivetrainWatchdog = false;
    retval = false;
  }

  constexpr double kTempThreshold = 50.0;
  constexpr uint32_t kTrippedRepeatMs = 5000;

  if (w.leftDrivetrainWatchdog) {
    const WatchHandle watch = Logger::getInstance().watch(
      "Left Drivetrain OK", LogLevel::INFO, WatchMode::onChange, 750,
      [this]() {
        return m_pLeftDrivetrain ? m_pLeftDrivetrain->get_temperature() : 0.0;
      }, LevelOverride<double>{
        .elevatedLevel = LogLevel::WARN,
        .predicate = asPredicate<double>([](const double& value) {
          return value >= kTempThreshold;
        }),
        .label = "Left Drivetrain Overheating"
      });
    configureDefaultWatch(watch.m_id, kTrippedRepeatMs);
  }

  if (w.rightDrivetrainWatchdog) {
    const WatchHandle watch = Logger::getInstance().watch(
      "Right Drivetrain OK", LogLevel::INFO, WatchMode::onChange, 750,
      [this]() {
        return m_pRightDrivetrain ? m_pRightDrivetrain->get_temperature() : 0.0;
      }, LevelOverride<double>{
        .elevatedLevel = LogLevel::WARN,
        .predicate = asPredicate<double>([](const double& value) {
          return value >= kTempThreshold;
        }),
        .label = "Right Drivetrain Overheating"
      });
    configureDefaultWatch(watch.m_id, kTrippedRepeatMs);
  }

  if (w.batteryWatchdog) {
    constexpr double kBatteryTempThreshold = 45.0;
    constexpr double kMinBatteryVoltage = 11.7;
    constexpr double kMaxBatteryVoltage = 13.25;

    const WatchHandle temperatureWatch = Logger::getInstance().watch(
      "Battery Temp OK", LogLevel::INFO, WatchMode::onChange, 750,
      []() {
        return pros::battery::get_temperature();
      }, LevelOverride<double>{
        .elevatedLevel = LogLevel::WARN,
        .predicate = asPredicate<double>([](const double& value) {
          return value >= kBatteryTempThreshold;
        }),
        .label = "Battery Temp High"
      });
    configureDefaultWatch(temperatureWatch.m_id, kTrippedRepeatMs);

    const WatchHandle voltageWatch = Logger::getInstance().watch(
      "Battery Voltage OK", LogLevel::INFO, WatchMode::onChange, 750,
      []() {
        return static_cast<double>(pros::battery::get_voltage()) / 1000.0;
      }, LevelOverride<double>{
        .elevatedLevel = LogLevel::WARN,
        .predicate = asPredicate<double>([](const double& v) {
          return v < kMinBatteryVoltage || v > kMaxBatteryVoltage;
      }),
        .label = "Battery Voltage Warning"
      });
    configureDefaultWatch(voltageWatch.m_id, kTrippedRepeatMs);
  }

  _MVLIB_FORWARD_DEBUG("setDefaultWatches set all applicable watches");

  return retval;
}
} // namespace mvlib
