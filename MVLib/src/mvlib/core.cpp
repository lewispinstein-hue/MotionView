#define _MVLIB_PREVENT_MACRO_CLEANUP
#include "mvlib/private/forwardLogMacros.h"
#include "mvlib/private/telemetry.hpp"
#include "mvlib/core.hpp"
#include "pros/apix.h"
#include "pros/rtos.hpp"
#include <cmath>

namespace mvlib {
Logger& Logger::getInstance() {
  static Logger instance;
  return instance;
}

bool Logger::setRobot(Drivetrain drivetrain, bool useSpeedEstimation) {
  if (m_configSet.load()) {
    _MVLIB_FORWARD_WARN("setRobot(Drivetrain) called after successfully being set!");
    return false;
  }

  if (m_started) {
    _MVLIB_FORWARD_WARN("setRobot(Drivetrain) called after logger start!");
    return false;
  }

  m_forceSpeedEstimation = useSpeedEstimation;

  if (!drivetrain.leftDrivetrain || !drivetrain.rightDrivetrain) {
    _MVLIB_FORWARD_FATAL("setRobot(Drivetrain) called with nullptr drivetrain arguments!");
    return false;
  }

  m_pLeftDrivetrain = drivetrain.leftDrivetrain;
  m_pRightDrivetrain = drivetrain.rightDrivetrain;

  _MVLIB_FORWARD_DEBUG("setRobot(Drivetrain) successfully set variables!");

  checkRobotConfig();
  m_configSet.store(true);
  return true;
}

bool Logger::checkRobotConfig() {
  detail::uniqueLock m(m_mutex, TIMEOUT_MAX);

  bool allValid = true;

  if (!m_pLeftDrivetrain) {
    _MVLIB_FORWARD_ERROR("checkRobotConfig() Left Drivetrain pointer is null!");
    allValid = false;
  }

  if (!m_pRightDrivetrain) {
    _MVLIB_FORWARD_ERROR("checkRobotConfig() Right Drivetrain pointer is null!");
    allValid = false;
  }

  return allValid;
}

Logger::Logger() {
  m_watches.reserve(24);
  m_waypoints.reserve(16);

  // Begin IO Handle for user logs by constructing singleton
  (void) detail::Telemetry::getInstance(); 

  // Disable PROS COBS; we do it ourselves
  pros::c::serctl(SERCTL_DISABLE_COBS, nullptr);
  // Disable PROS prepending messages with "sout"
  pros::c::serctl(SERCTL_DEACTIVATE, (void*)0x74756f73);
}

void Logger::start() {
  if (m_started) {
    _MVLIB_FORWARD_WARN("start() called more than once. Aborted!");
    return;
  }
  m_started = true;

  // SD init
  if (m_config.logToSD.load() && !m_sdFile) {
    bool success = initSDLogger();
    if (!success) {
      m_config.logToSD.store(false);
      m_sdLocked = true;
      _MVLIB_FORWARD_FATAL("start() initSDCard failed! Unable to initialize SD card.");
    } else {
      _MVLIB_FORWARD_INFO("start() Successfully initialized SD card with filename: %s", m_absoluteFilename);
    }
  }

  if (!checkRobotConfig()) {
    _MVLIB_FORWARD_ERROR("start() failed! At least one pointer set by setRobot(Drivetrain) is nullptr. Using speed estimation.");
  }

  m_task = std::make_unique<pros::Task>([this]() mutable {
    if (m_config.logToTerminal.load()) pros::delay(1000);
    uint32_t now = pros::millis();
    while (true) {
      if (m_pauseRequested.load()) {
        pros::delay(100);
        now = pros::millis();
        continue;
      }

      try { this->update(); }
      catch (std::exception& e) {
        _MVLIB_FORWARD_ERROR("MVLib Update loop exception: %s", e.what());
      }

      if (m_config.logToTerminal.load()) {
        if (m_timings.stdoutBufferFlushInterval != 0 &&
            now - m_lastTerminalFlush >= m_timings.stdoutBufferFlushInterval) {
          fflush(stdout);
          m_lastTerminalFlush = now;
        }
      }
      pros::Task::delay_until(&now, 40);
    }
  }, TASK_PRIORITY_DEFAULT, TASK_STACK_DEPTH_DEFAULT, "MVLib Logger");
  _MVLIB_FORWARD_INFO("start() Background logger task started.");
}

void Logger::update() {
  uint32_t now = pros::millis();

  if (m_config.printWatches.load()) printWatches();
  if (m_config.printWaypoints.load()) printWaypoints();

  uint32_t telemetryRate = m_config.logToTerminal.load() ?
      m_timings.terminalPollingRate : m_timings.sdPollingRate;

  if (telemetryRate != 0 && now - m_lastTelemetryPrint >= telemetryRate) {
    if (m_config.printTelemetry.load()) printTelemetry();
    m_lastTelemetryPrint = now;
  }

  // Periodically sync IDs to labels so the frontend can resolve them
  if (m_timings.rosterSyncAllInterval != 0 &&
      now - m_lastRosterFlush >= m_timings.rosterSyncAllInterval) {
    this->resyncAllWatchesRoster();
    this->resyncAllWaypointsRoster();
    m_lastRosterFlush = now;
  }
}
} // namespace mvlib
