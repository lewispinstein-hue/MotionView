#include "pros/rtos.hpp"
#include "mvlib/core.hpp"
#include "mvlib/private/forwardLogMacros.h"
#include "mvlib/telemetry.hpp"
#include "pros/apix.h"
#include <cmath>
#include <algorithm>

namespace mvlib {

Logger &Logger::getInstance() {
  static Logger instance;
  return instance;
}

bool Logger::setRobot(Drivetrain drivetrain, bool useSpeedEstimation) {
  if (m_configSet) {
    _MVLIB_FORWARD_WARN("setRobot(Drivetrain) called after successfully being set!");
    return false;
  }
  m_forceSpeedEstimation = useSpeedEstimation;

  if (!drivetrain.leftDrivetrain || !drivetrain.rightDrivetrain) {
    _MVLIB_FORWARD_FATAL("setRobot(Drivetrain) called with nullptr drivetrain arguments!");
    return false;
  }

  m_pLeftDrivetrain = drivetrain.leftDrivetrain;
  m_pRightDrivetrain = drivetrain.rightDrivetrain;

  _MVLIB_FORWARD_DEBUG("setRobot() successfully set variables!");

  m_configValid = m_checkRobotConfig();
  m_configSet = true;
  return true;
}

bool Logger::m_checkRobotConfig() {
  unique_lock m(m_mutex, TIMEOUT_MAX);

  bool allValid = true;

  if (!m_pLeftDrivetrain) {
    _MVLIB_FORWARD_ERROR("Left Drivetrain pointer is NULL!");
    allValid = false;
  }
  if (!m_pRightDrivetrain) {
    _MVLIB_FORWARD_ERROR("Right Drivetrain pointer is NULL!");
    allValid = false;
  }

  return allValid;
}

Logger::Logger() {
  m_watches.reserve(24);
  m_waypoints.reserve(16);

  // Begin IO Handle for user logs by constructing singleton
  (void) Telemetry::getInstance(); 

  // Disable PROS CBOS; we do it ourselves
  pros::c::serctl(SERCTL_DISABLE_COBS, nullptr);
  // Disable PROS prepending messages with "sout"
  pros::c::serctl(SERCTL_DEACTIVATE, (void*)0x74756f73);
}

uint32_t Logger::status() const {
  if (!m_task) return pros::E_TASK_STATE_INVALID;
  return m_task->get_state();
}

void Logger::pause(bool byForce) {
  uint32_t st = status();
  bool isPauseable = st != pros::E_TASK_STATE_DELETED && 
                     st != pros::E_TASK_STATE_INVALID &&
                     st != pros::E_TASK_STATE_SUSPENDED;

  if (isPauseable && byForce) {
    m_task->suspend();
    _MVLIB_FORWARD_DEBUG("Logger force suspended.");
  } else if (isPauseable) {
    m_pauseRequested.store(true);
    _MVLIB_FORWARD_DEBUG("Logger paused.");
  } else {
    _MVLIB_FORWARD_DEBUG("Logger cannot be paused as it is not in a running state.");
  }
}

void Logger::resume() {
  uint32_t st = status();
  bool wasPaused = false;

  if (m_pauseRequested.exchange(false)) wasPaused = true;

  if (st != pros::E_TASK_STATE_DELETED && 
      st != pros::E_TASK_STATE_INVALID && 
      st == pros::E_TASK_STATE_SUSPENDED) {
    m_task->resume();
    wasPaused = true;
  }

  if (wasPaused) {
    _MVLIB_FORWARD_DEBUG("Logger resumed.");
  } else {
    _MVLIB_FORWARD_DEBUG("Logger cannot be resumed as it is not paused.");
  }
}

void Logger::start() {
  if (m_started) {
    _MVLIB_FORWARD_WARN("start() called more than once. Aborted!");
    return;
  }
  m_started = true;

  // SD init
  if (m_config.logToSD.load() && !m_sdFile) {
    bool success = m_initSDLogger();
    if (!success) {
      m_config.logToSD.store(false);
      m_sdLocked = true;
      _MVLIB_FORWARD_FATAL("initSDCard failed! Unable to initialize SD card.");
    } else {
      _MVLIB_FORWARD_DEBUG("Successfully initialized SD card with filename: %s", m_currentFilename);
    }
  }
    
  m_configValid = m_checkRobotConfig();
  if (!m_configValid) {
    _MVLIB_FORWARD_ERROR("At least one pointer set by setRobot(Drivetrain) is nullptr. Using speed estimation.");
  }

  m_task = std::make_unique<pros::Task>([this]() mutable {
    if (m_config.logToTerminal.load()) pros::delay(1000);
    uint32_t now = pros::millis();
    while (true) {
      if (m_pauseRequested.load()) {
        pros::delay(200);
        continue;
      }

      try { this->Update(); }
      catch (std::exception& e) {
        _MVLIB_FORWARD_ERROR("MVLib Update loop exception: %s", e.what());
      }

      if (m_config.logToTerminal.load()) {
        if (m_timings.stdoutBufferFlushInterval != 0 &&
            now - m_lastTerminalFlush >= m_timings.stdoutBufferFlushInterval) {
          fflush(stdout);
          m_lastTerminalFlush = now;
        }
        pros::Task::delay_until(&now, m_timings.terminalPollingRate);
      } else {
        pros::Task::delay_until(&now, m_timings.sdPollingRate);
      }
    }
  }, TASK_PRIORITY_DEFAULT, TASK_STACK_DEPTH_DEFAULT, "MVLib Logger");
}

void Logger::Update() {
  if (m_config.printWatches.load()) printWatches();
  if (m_config.printWaypoints.load()) printWaypoints();

  // Periodically sync IDs to labels so the frontend can resolve them
  if (m_timings.rosterSyncAllInterval != 0 &&
      pros::millis() - m_lastRosterFlush >= m_timings.rosterSyncAllInterval) {
    this->resyncAllWatchesRoster();
    this->resyncAllWaypointsRoster();
    m_lastRosterFlush = pros::millis();
  }

  static double leftVelocity, rightVelocity;
  std::optional<Pose> pose = std::nullopt;

  if (m_getPose) {
    unique_lock lock(m_mutex);
    pose = m_getPose();
  }
  
  if (m_configValid && m_pLeftDrivetrain && m_pRightDrivetrain && !m_forceSpeedEstimation) {
    auto norm = [&](const double& rpm, const pros::MotorGears& gearset) {
      double maxRpm = 100.0;
      if (gearset == pros::MotorGears::rpm_200) maxRpm = 200.0;
      else if (gearset == pros::MotorGears::rpm_600) maxRpm = 600.0;
      return std::clamp((rpm / maxRpm) * 127.0, -127.0, 127.0);
    };

    leftVelocity = norm(m_pLeftDrivetrain->get_actual_velocity(), m_pLeftDrivetrain->get_gearing());
    rightVelocity = norm(m_pRightDrivetrain->get_actual_velocity(), m_pRightDrivetrain->get_gearing());
  } else {
    static Pose prevPose;
    static uint32_t prevMs = pros::millis();
    static double fallbackSpeed = 0.0;
    if (pose.has_value()) {
      uint32_t nowMs = pros::millis();
      double dt = (nowMs - prevMs) / 1000.0;
      double vx = (dt > 0) ? (pose->x - prevPose.x) / dt : 0.0;
      double vy = (dt > 0) ? (pose->y - prevPose.y) / dt : 0.0;
      double avgSpeed = std::sqrt(vx * vx + vy * vy);
      leftVelocity = rightVelocity = fallbackSpeed = avgSpeed;
      prevPose = pose.value();
      prevMs = nowMs;
    } else {
      leftVelocity = rightVelocity = fallbackSpeed;
    }
  }

  if (m_config.printTelemetry.load() && pose.has_value()) {
    const double normTheta = normalizeDegrees360(pose->theta);
    
    if (std::isfinite(pose->x) && std::isfinite(pose->y) && std::isfinite(pose->theta)) {
      // Send binary through terminal
      if (m_config.logToTerminal.load()) {
        PosePacket pkt;
        pkt.timestamp = static_cast<uint16_t>(pros::millis());
        pkt.x = (float)pose->x;
        pkt.y = (float)pose->y;
        pkt.theta = packTelemetryTheta(pose->theta);
        pkt.leftVel = packTelemetryVelocity(leftVelocity);
        pkt.rightVel = packTelemetryVelocity(rightVelocity);
        Telemetry::getInstance().sendPose(pkt);
      }

      // Log standard ANSII to the sd card
      if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
        logToSD(LogLevel::OVERRIDE, "[POSE],%u,%.2f,%.2f,%.2f,%.0f,%.0f", 
                pros::millis(), pose->x, pose->y, normTheta, leftVelocity, rightVelocity);
      }
    }
  }
}
} // namespace mvlib
