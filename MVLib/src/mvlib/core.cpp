#define _MVLIB_PREVENT_MACRO_CLEANUP
#include "mvlib/private/forwardLogMacros.h"
#include "mvlib/private/telemetry.hpp"
#include "mvlib/core.hpp"
#include "pros/apix.h"
#include "pros/rtos.hpp"
#include <algorithm>
#include <cmath>

namespace mvlib {
namespace {
float estimateSpeed(const Pose& prevPose, const Pose& pose) {
  static uint32_t prevMs = pros::millis();
  uint32_t nowMs = pros::millis();
  const float dt = (nowMs - prevMs) / 1000.0;
  const float vx = (dt > 0) ? (pose.x - prevPose.x) / dt : 0.0;
  const float vy = (dt > 0) ? (pose.y - prevPose.y) / dt : 0.0;
  prevMs = nowMs;
  return std::sqrt(vx * vx + vy * vy);
}
} // namespace

Logger& Logger::getInstance() {
  static Logger instance;
  return instance;
}

bool Logger::setRobot(Drivetrain drivetrain, bool useSpeedEstimation) {
  if (m_configSet.load()) {
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
  _MVLIB_FORWARD_INFO("start() Background logger task started.");
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

  std::optional<Pose> pose = std::nullopt;
  std::shared_ptr<std::function<std::optional<Pose>()>> poseGetter;
  std::shared_ptr<pros::Mutex> poseGetterMutex;
  double leftVelocity, rightVelocity = 0.0;

  {
    detail::uniqueLock lock(m_mutex);
    if (lock.isLocked()) {
      poseGetter = m_getPose;
      poseGetterMutex = m_poseGetterMutex;
    }
  }

  if (poseGetter && poseGetterMutex) {
    detail::uniqueLock callbackLock(*poseGetterMutex, TIMEOUT_MAX);
    if (callbackLock.isLocked()) {
      pose = (*poseGetter)();
    }
  }

  const bool useSpeedEstimation =
    !configValid() ||
    m_forceSpeedEstimation;

  if (!useSpeedEstimation) {
    static auto norm = [&](const double& rpm, const pros::MotorGears& gearset) {
      double maxRpm = 100.0;
      if (gearset == pros::MotorGears::rpm_200) maxRpm = 200.0;
      else if (gearset == pros::MotorGears::rpm_600) maxRpm = 600.0;
      return std::clamp((rpm / maxRpm) * 127.0, -127.0, 127.0);
    };

    leftVelocity = norm(m_pLeftDrivetrain->get_actual_velocity(), m_pLeftDrivetrain->get_gearing());
    rightVelocity = norm(m_pRightDrivetrain->get_actual_velocity(), m_pRightDrivetrain->get_gearing());
  } else {
    static double fallbackSpeed = 0.0;
    static Pose prevPose{};
    if (pose.has_value()) {
      leftVelocity = rightVelocity = fallbackSpeed = estimateSpeed(prevPose, pose.value());
      prevPose = pose.value();
    } else {
      leftVelocity = rightVelocity = fallbackSpeed;
    }
  }

  const bool validPose =
    pose.has_value() &&
    std::isfinite(pose->x) &&
    std::isfinite(pose->y) &&
    std::isfinite(pose->theta);

  if (validPose && m_config.printTelemetry.load()) {
    // Send binary through terminal
    if (m_config.logToTerminal.load()) {
      detail::PosePacket pkt;
      pkt.timestamp = static_cast<uint16_t>(pros::millis());
      pkt.x = static_cast<float>(pose.value().x);
      pkt.y = static_cast<float>(pose.value().y);
      pkt.theta = detail::packTelemetryTheta(pose.value().theta);
      pkt.leftVel = detail::packTelemetryVelocity(leftVelocity);
      pkt.rightVel = detail::packTelemetryVelocity(rightVelocity);
      detail::Telemetry::getInstance().sendPose(pkt);
    }

    // Log standard ANSII to the sd card
    if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
      const double normTheta = [pose]() {
        double theta = fmod(pose.value().theta, 360.0);
        if (theta < 0.0) theta += 360.0;
        return theta;
      }();
      logToSD(LogLevel::OVERRIDE, "[POSE],%u,%.2f,%.2f,%.2f,%.0f,%.0f",
              pros::millis(), pose->x, pose->y, normTheta, leftVelocity, rightVelocity);
    }
  }
}
} // namespace mvlib
