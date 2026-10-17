#include "mvlib/core.hpp"
#include "mvlib/private/terminalOut.hpp"
#include "mvlib/private/raii.hpp"
#include <cerrno>
#include <cmath>
#include <cstdlib>

namespace mvlib {
namespace {
double estimateSpeed(const Pose& prevPose, const Pose& pose) {
  static uint32_t prevMs = pros::millis();
  uint32_t nowMs = pros::millis();
  const double dt = (nowMs - prevMs) / 1000.0;
  const double vx = (dt > 0) ? (pose.x - prevPose.x) / dt : 0.0;
  const double vy = (dt > 0) ? (pose.y - prevPose.y) / dt : 0.0;
  prevMs = nowMs;

  const double magnitude = std::sqrt(vx * vx + vy * vy);
  // MotionView poses use 0 degrees facing +Y, rather than the mathematical
  // convention of 0 degrees on +X. Project onto that reported heading to
  // distinguish forward from backward odometry motion.
  constexpr double kDegreesToRadians = 3.14159265358979323846 / 180.0;
  const double headingRadians = pose.theta * kDegreesToRadians;
  const double forward = vx * std::sin(headingRadians) +
                         vy * std::cos(headingRadians);
  return std::copysign(magnitude, forward);
}
} // namespace

void Logger::printTelemetry() {
  std::optional<Pose> pose = std::nullopt;
  std::shared_ptr<std::function<std::optional<Pose>()>> poseGetter;
  std::shared_ptr<pros::Mutex> poseGetterMutex;
  double leftVelocity = 0.0;
  double rightVelocity = 0.0;
  bool hasNonFiniteVelocity = false;

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

  const bool validPose =
    pose.has_value() &&
    std::isfinite(pose->x) &&
    std::isfinite(pose->y) &&
    std::isfinite(pose->theta);

  if (!validPose) return;

  const bool useSpeedEstimation =
    !configValid() || m_forceSpeedEstimation;

  if (!useSpeedEstimation) {
    static auto norm = [](const double& rpm, pros::MotorGears gearset) {
      double maxRpm = 100.0;
      if (gearset == pros::MotorGears::rpm_200) maxRpm = 200.0;
      else if (gearset == pros::MotorGears::rpm_600) maxRpm = 600.0;
      return std::clamp((rpm / maxRpm) * 127.0, -127.0, 127.0);
    };

    const double leftRpm = m_pLeftDrivetrain->get_actual_velocity();
    const double rightRpm = m_pRightDrivetrain->get_actual_velocity();
    hasNonFiniteVelocity =
        !std::isfinite(leftRpm) || !std::isfinite(rightRpm);
    leftVelocity = hasNonFiniteVelocity
                       ? leftRpm
                       : norm(leftRpm, m_pLeftDrivetrain->get_gearing());
    rightVelocity = hasNonFiniteVelocity
                        ? rightRpm
                        : norm(rightRpm, m_pRightDrivetrain->get_gearing());
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

  hasNonFiniteVelocity = hasNonFiniteVelocity || !std::isfinite(leftVelocity) ||
                         !std::isfinite(rightVelocity);

  // Send binary through terminal
  if (ensureTerminalSession()) {
    const uint16_t timestamp = static_cast<uint16_t>(pros::millis());
    const float x = static_cast<float>(pose->x);
    const float y = static_cast<float>(pose->y);
    const uint16_t theta = detail::packTelemetryTheta(pose->theta);
    if (hasNonFiniteVelocity) {
      detail::PoseRawVelocityPacket pkt{timestamp, x, y, theta,
                                         static_cast<float>(leftVelocity),
                                         static_cast<float>(rightVelocity)};
      detail::Telemetry::getInstance().sendPoseWithRawVelocities(pkt);
    } else {
      detail::PosePacket pkt{timestamp, x, y, theta,
                              detail::packTelemetryVelocity(leftVelocity),
                              detail::packTelemetryVelocity(rightVelocity)};
      detail::Telemetry::getInstance().sendPose(pkt);
    }
  }

  // Log standard ANSI text to the SD card.
  if (m_config.logToSD.load()) {
    const double normTheta = [pose]() {
      double theta = fmod(pose.value().theta, 360.0);
      if (theta < 0.0) theta += 360.0;
      return theta;
    }();
    logToSD(LogLevel::OVERRIDE, "[POSE],%u,%.2f,%.2f,%.2f,%.0f,%.0f",
            pros::millis(), pose->x, pose->y, normTheta, leftVelocity, rightVelocity);
  }
}
} // namespace mvlib
