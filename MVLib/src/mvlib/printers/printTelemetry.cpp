#include "mvlib/core.hpp"
#include "mvlib/private/telemetry.hpp"
#include "mvlib/private/raii.hpp"
#include <cerrno>
#include <cmath>
#include <cstdlib>

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
} // namespace mvlib