#include "mvlib/core.hpp"
#include "mvlib/private/telemetry.hpp"
#include "mvlib/private/raii.hpp"
#include <cerrno>
#include <cmath>
#include <cstdlib>

namespace mvlib {
namespace {
constexpr double kDegToRad = 3.14159265358979323846 / 180.0;

// Returns the pose-based fallback speed estimate normalized to the same
// +-127 scale the drivetrain-reported speed path uses, so both paths are
// comparable on the wire. Sign is taken from whether the motion is forward
// or backward relative to heading.
double estimateSpeed(const Pose& prevPose, const Pose& pose, double maxFieldUnitsPerSecond) {
  static uint32_t prevMs = pros::millis();
  uint32_t nowMs = pros::millis();
  const float dt = (nowMs - prevMs) / 1000.0;
  const float vx = (dt > 0) ? (pose.x - prevPose.x) / dt : 0.0;
  const float vy = (dt > 0) ? (pose.y - prevPose.y) / dt : 0.0;
  prevMs = nowMs;

  const float magnitude = std::sqrt(vx * vx + vy * vy);
  const float headingRad = pose.theta * kDegToRad;
  const float forward = vx * std::cos(headingRad) + vy * std::sin(headingRad);
  const float signedSpeed = std::copysign(magnitude, forward);

  if (maxFieldUnitsPerSecond <= 0.0) return 0.0;
  return std::clamp((signedSpeed / maxFieldUnitsPerSecond) * 127.0, -127.0, 127.0);
}
} // namespace

void Logger::printTelemetry() {
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

  const bool validPose =
    pose.has_value() &&
    std::isfinite(pose->x) &&
    std::isfinite(pose->y) &&
    std::isfinite(pose->theta);

  if (!validPose) return;

  const bool useSpeedEstimation =
    !configValid() || m_forceSpeedEstimation;

  if (!useSpeedEstimation) {
    static auto norm = [&](const double& rpm, pros::MotorGears gearset) {
      if (!std::isfinite(rpm)) return 0.0;
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
      leftVelocity = rightVelocity = fallbackSpeed =
        estimateSpeed(prevPose, pose.value(), m_estimatedSpeedMax.load());
      prevPose = pose.value();
    } else {
      leftVelocity = rightVelocity = fallbackSpeed;
    }
  }

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
