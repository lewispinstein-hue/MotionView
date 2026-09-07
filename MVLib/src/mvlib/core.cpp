#define _MVLIB_PREVENT_MACRO_CLEANUP
#include "mvlib/private/forwardLogMacros.h"
#include "mvlib/private/sdSink.hpp"
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
  detail::uniqueLock lock(m_mutex, TIMEOUT_MAX);
  if (!lock.isLocked()) return false;

  if (m_configSet.load()) {
    _MVLIB_FORWARD_WARN("setRobot(Drivetrain) called after successfully being set!");
    return false;
  }

  if (m_started.load()) {
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
  m_sdSink = std::make_unique<detail::SdSink>();
  m_sdSink->setFlushInterval(m_sdBufferFlushInterval.load());

  // Begin IO Handle for user logs by constructing singleton
  (void) detail::Telemetry::getInstance();

  // Disable PROS COBS; we do it ourselves
  pros::c::serctl(SERCTL_DISABLE_COBS, nullptr);
  // Disable PROS prepending messages with "sout"
  pros::c::serctl(SERCTL_DEACTIVATE, (void*)0x74756f73);
}

Logger::~Logger() = default;

void Logger::start() {
  bool expected = false;
  if (!m_started.compare_exchange_strong(expected, true)) {
    _MVLIB_FORWARD_WARN("start() called more than once. Aborted!");
    return;
  }

  {
    detail::uniqueLock setupLock(m_mutex, TIMEOUT_MAX);
    if (!setupLock.isLocked()) {
      _MVLIB_FORWARD_ERROR("start() could not acquire the configuration lock. Aborting startup.");
      return;
    }

    // SD init
    if (m_config.logToSD.load() && !m_sdSink->ready()) {
      bool success = initSDLogger();
      if (!success) {
        m_config.logToSD.store(false);
        m_sdSink->lock();
      }
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

      try {
        this->update();
      } catch (std::exception& e) {
        _MVLIB_FORWARD_ERROR("MVLib Update loop exception: %s", e.what());
      }

      if (m_config.logToTerminal.load()) {
        const uint32_t flushInterval = m_stdoutBufferFlushInterval.load();
        if (flushInterval != 0 && now - m_lastTerminalFlush >= flushInterval) {
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

  const uint32_t telemetryRate = m_config.logToTerminal.load() ?
      m_terminalPollingRate.load() : m_sdPollingRate.load();

  if (telemetryRate != 0 && now - m_lastTelemetryPrint >= telemetryRate) {
    if (m_config.printTelemetry.load()) printTelemetry();
    m_lastTelemetryPrint = now;
  }

  // Periodically sync IDs to labels so the frontend can resolve them
  const uint32_t rosterSyncInterval = m_rosterSyncAllInterval.load();
  if (rosterSyncInterval != 0 && now - m_lastRosterFlush >= rosterSyncInterval) {
    this->resyncAllWatchesRoster();
    this->resyncAllWaypointsRoster();
    m_lastRosterFlush = now;
  }
}
} // namespace mvlib
