#include "mvlib/core.hpp"
#include "mvlib/private/forwardLogMacros.h"
#include "pros/misc.hpp"
#include "pros/rtos.hpp"
#include <cstdint>

namespace mvlib {

struct WatchInfo {
  int16_t currVal{0};
  int16_t prevVal{0};
  double displayValue{0};
  uint32_t lastLogTime{0};
};  

bool Logger::setDefaultWatches(const DefaultWatches& watches) {
  DefaultWatches w = watches;
  bool retval = true;
  if (!m_configSet || !m_configValid) {
    _MVLIB_FORWARD_WARN("Drivetrain watches could not be set because config is not "
                        "set or invalid! Did you make sure to set config before default "
                        "watches?");
    w.leftDrivetrainWatchdog = false;
    w.rightDrivetrainWatchdog = false;
    retval = false;
  }

  // Common threshold for drivetrain components
  constexpr int16_t TEMP_THRESHOLD = 50;
  constexpr uint32_t DEBOUNCE_MS = 5000; // How often to force emit if tripped

  if (w.leftDrivetrainWatchdog) {
    Logger::getInstance().watch("Left Drivetrain OK", LogLevel::INFO, true,
      [info = WatchInfo{
        .prevVal = (int16_t)(m_pLeftDrivetrain ? m_pLeftDrivetrain->get_temperature() : 0),
        .displayValue = m_pLeftDrivetrain ? m_pLeftDrivetrain->get_temperature() : 0
      }, this, TEMP_THRESHOLD, DEBOUNCE_MS]() mutable {
        info.currVal = m_pLeftDrivetrain ? (int16_t)m_pLeftDrivetrain->get_temperature() : 0;
        uint32_t now = pros::millis();

        bool currBad = info.currVal >= TEMP_THRESHOLD;
        bool prevBad = info.prevVal >= TEMP_THRESHOLD;

        if (currBad && !prevBad) {
          // Edge case: Just crossed into bad territory
          info.displayValue = info.currVal;
          info.lastLogTime = now;
        } else if (currBad && prevBad) {
          // State: Remaining bad. Check debounce.
          if (now - info.lastLogTime >= DEBOUNCE_MS) {
            info.lastLogTime = now;
            info.displayValue = info.currVal;
          }
        } else if (!currBad && prevBad) {
          // Edge case: Just recovered to normal
          info.displayValue = info.currVal;
        }

        info.prevVal = info.currVal;
        return info.displayValue;
      }, 
      LevelOverride<double>{
        .elevatedLevel = LogLevel::WARN,
        .predicate = PREDICATE(v > TEMP_THRESHOLD),
        .label = "Left Drivetrain Overheating"
      },
      "%.1f"
    );
    _MVLIB_FORWARD_INFO("Created default Left Drivetrain watch.");
  }

  if (w.rightDrivetrainWatchdog) {
    Logger::getInstance().watch("Right Drivetrain OK", LogLevel::INFO, true,
      [info = WatchInfo{
        .prevVal = (int16_t)(m_pRightDrivetrain ? m_pRightDrivetrain->get_temperature() : 0),
        .displayValue = m_pRightDrivetrain ? m_pRightDrivetrain->get_temperature() : 0
      }, this, TEMP_THRESHOLD, DEBOUNCE_MS]() mutable {
        info.currVal = m_pRightDrivetrain ? (int16_t)m_pRightDrivetrain->get_temperature() : 0;
        uint32_t now = pros::millis();

        bool currBad = info.currVal >= TEMP_THRESHOLD;
        bool prevBad = info.prevVal >= TEMP_THRESHOLD;

        if (currBad && !prevBad) {
          info.displayValue = info.currVal;
          info.lastLogTime = now;
        } else if (currBad && prevBad) {
          if (now - info.lastLogTime >= DEBOUNCE_MS) {
            info.lastLogTime = now;
            info.displayValue = info.currVal;
          }
        } else if (!currBad && prevBad) {
          info.displayValue = info.currVal;
        }

        info.prevVal = info.currVal;
        return info.displayValue;
      }, 
      LevelOverride<double>{
        .elevatedLevel = LogLevel::WARN,
        .predicate = PREDICATE(v > TEMP_THRESHOLD),
        .label = "Right Drivetrain Overheating"
      },
      "%.1f"
    );
    _MVLIB_FORWARD_INFO("Created default Right Drivetrain watch.");
  }

  if (w.batteryWatchdog) {
    constexpr int16_t BAT_TEMP_THRESHOLD = 45;

    // Battery Temperature Watch
    Logger::getInstance().watch("Battery Temp OK", LogLevel::INFO, true,
      [info = WatchInfo{
        .prevVal = (int16_t)pros::battery::get_temperature(),
        .displayValue = pros::battery::get_temperature()
      }, BAT_TEMP_THRESHOLD, DEBOUNCE_MS]() mutable {
        info.currVal = (int16_t)pros::battery::get_temperature();
        uint32_t now = pros::millis();

        bool currBad = info.currVal >= BAT_TEMP_THRESHOLD;
        bool prevBad = info.prevVal >= BAT_TEMP_THRESHOLD;

        if (currBad && !prevBad) {
          info.displayValue = info.currVal;
          info.lastLogTime = now;
        } else if (currBad && prevBad) {
          if (now - info.lastLogTime >= DEBOUNCE_MS) {
            info.lastLogTime = now;
            info.displayValue = info.currVal;
          }
        } else if (!currBad && prevBad) {
          info.displayValue = info.currVal;
        }

        info.prevVal = info.currVal;
        return info.displayValue;
      },
      LevelOverride<double>{
        .elevatedLevel = LogLevel::WARN,
        .predicate = PREDICATE(v > BAT_TEMP_THRESHOLD),
        .label = "Battery Temp High"
      }, 
      "%.1f"
    );
    _MVLIB_FORWARD_INFO("Created default Battery Temperature Watch");

    // Battery Voltage Watch (thresholds in millivolts)
    constexpr uint MIN_BAT_VOLT = 12000;
    constexpr uint MAX_BAT_VOLT = 13250;

    Logger::getInstance().watch("Battery Voltage OK", LogLevel::INFO, true,
      [info = WatchInfo{
        .prevVal = (int16_t)pros::battery::get_voltage(),
        .displayValue = (double)pros::battery::get_voltage()
      }, MIN_BAT_VOLT, MAX_BAT_VOLT, DEBOUNCE_MS, this]() mutable {
        info.currVal = (int16_t)pros::battery::get_voltage();
        uint32_t now = pros::millis();

        bool currBad = (info.currVal < (int16_t)MIN_BAT_VOLT || info.currVal > (int16_t)MAX_BAT_VOLT);
        bool prevBad = (info.prevVal < (int16_t)MIN_BAT_VOLT || info.prevVal > (int16_t)MAX_BAT_VOLT);

        if (currBad && !prevBad) {
          info.displayValue = info.currVal;
          info.lastLogTime = now;
        } else if (currBad && prevBad) {
          if (now - info.lastLogTime >= DEBOUNCE_MS) {
            info.lastLogTime = now;
            info.displayValue = info.currVal;
          }
        } else if (!currBad && prevBad) {
          info.displayValue = info.currVal;
        }

        info.prevVal = info.currVal;
        return info.displayValue / 1000.0;
      },
      LevelOverride<double>{
        .elevatedLevel = LogLevel::WARN,
        .predicate = PREDICATE(
          (v * 1000) < MIN_BAT_VOLT || (v * 1000) > MAX_BAT_VOLT
        ),
        .label = "Battery Voltage Warning"
      }, 
      "%.2f"
    );

    _MVLIB_FORWARD_INFO("Created default Battery Voltage Watch");
  }

  return retval;
}
} // namespace mvlib
