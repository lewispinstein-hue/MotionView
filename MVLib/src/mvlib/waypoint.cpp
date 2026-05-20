#include "mvlib/core.hpp"
#include "mvlib/private/telemetry.hpp"
#include "mvlib/waypoint.hpp"
#include "mvlib/private/raii.hpp"
#include <limits>
#include <cmath>
#include <cstdio> 
#include <string>
#include <algorithm>

namespace mvlib {
namespace {
std::string formatParams(const WaypointParams& params) {
  char buf[256];
  snprintf(buf, sizeof(buf), "%.2f,%.2f,%s,%s,%.2f,%s,%d",
           params.tarX, params.tarY,
           params.tarT.has_value() ? std::to_string(params.tarT.value()).c_str() : "NA",
           params.timeoutMs.has_value() ? std::to_string(params.timeoutMs.value()).c_str() : "NA",
           params.linearTol,
           params.thetaTol.has_value() ? std::to_string(params.thetaTol.value()).c_str() : "NA",
           params.retriggerable ? 1 : 0); 
  return std::string(buf);
}
} // namespace

Logger::InternalWaypoint* Logger::m_findWaypointUnlocked(WPId id) {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                         [id](const InternalWaypoint& waypoint) { return waypoint.id == id; });
  return (it == m_waypoints.end()) ? nullptr : &(*it);
}

const Logger::InternalWaypoint* Logger::m_findWaypointUnlocked(WPId id) const {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                         [id](const InternalWaypoint& waypoint) { return waypoint.id == id; });
  return (it == m_waypoints.end()) ? nullptr : &(*it);
}

WaypointOffset Logger::getWaypointOffset(WPId id) {
  WaypointParams params{};
  uint32_t startTimeMs = 0;
  std::shared_ptr<std::function<std::optional<Pose>()>> poseGetter;
  std::shared_ptr<pros::Mutex> poseGetterMutex;

  {
    detail::uniqueLock lock(m_mutex);
    if (!lock.isLocked()) return {};

    const InternalWaypoint* waypoint = m_findWaypointUnlocked(id);
    if (!waypoint) return {};
    params = waypoint->params;
    startTimeMs = waypoint->startTimeMs;
    poseGetter = m_getPose;
    poseGetterMutex = m_poseGetterMutex;
  }

  WaypointOffset offset;
  std::optional<Pose> pose = std::nullopt;
  if (poseGetter && poseGetterMutex) {
    detail::uniqueLock callbackLock(*poseGetterMutex, TIMEOUT_MAX);
    if (callbackLock.isLocked()) {
      pose = (*poseGetter)();
    }
  }
  if (!pose) return {};

  // Linear Offsets
  offset.offX = params.tarX - pose->x;
  offset.offY = params.tarY - pose->y;
  offset.totalOffset = sqrt(offset.offX * offset.offX + offset.offY * offset.offY);

  // Angular Offset (Wrapped to [-180, 180])
  if (params.tarT.has_value()) {
    double error = params.tarT.value() - pose->theta;
    error = fmod(error + 180.0, 360.0);
    if (error < 0) error += 360.0;
    offset.offT = error - 180.0;
  }

  // Timeout Evaluation
  if (params.timeoutMs.has_value()) {
    uint32_t elapsed = pros::millis() - startTimeMs;
    if (elapsed >= params.timeoutMs.value()) {
      offset.timedOut = true;
      offset.remainingTimeout = 0;
    } else {
      offset.remainingTimeout = params.timeoutMs.value() - elapsed;
      offset.timedOut = false;
    }
  } else {
    offset.remainingTimeout = std::nullopt;
    offset.timedOut = false;
  }

  // Reached Logic
  bool linearReached = offset.totalOffset <= params.linearTol;
  bool angularReached = !params.thetaTol.has_value() ||
                        (offset.offT.has_value() && 
                        std::abs(offset.offT.value()) <= params.thetaTol.value());

  offset.reached = (linearReached && angularReached);
  return offset;
}

bool Logger::isWaypointReached(WPId id) {
  WaypointParams params{};
  std::shared_ptr<std::function<std::optional<Pose>()>> poseGetter;
  std::shared_ptr<pros::Mutex> poseGetterMutex;

  {
    detail::uniqueLock lock(m_mutex);
    if (!lock.isLocked()) return false;

    const InternalWaypoint* waypoint = m_findWaypointUnlocked(id);
    if (!waypoint || !waypoint->active) return {};
    params = waypoint->params;
    poseGetter = m_getPose;
    poseGetterMutex = m_poseGetterMutex;
  }

  std::optional<Pose> pose = std::nullopt;
  if (poseGetter && poseGetterMutex) {
    detail::uniqueLock callbackLock(*poseGetterMutex, TIMEOUT_MAX);
    if (callbackLock.isLocked()) {
      pose = (*poseGetter)();
    }
  }
  if (!pose) return false;

  // Linear Offsets
  float linOffset = sqrt(pow(params.tarX - pose->x, 2) +
                         pow(params.tarY - pose->y, 2));
  bool linearReached = linOffset <= params.linearTol;

  bool angularReached = !params.thetaTol.has_value();
  // Angular Offset (Wrapped to [-180, 180])
  if (params.tarT.has_value()) {
    double error = params.tarT.value() - pose->theta;
    error = fmod(error + 180.0, 360.0);
    if (error < 0) error += 360.0;
    angularReached = std::abs(error - 180.0) <= params.thetaTol.value();
  }

  return linearReached && angularReached;
}

WaypointHandle Logger::internalRegisterWaypoint(std::string name, WaypointParams details) {
  detail::uniqueLock lock(m_mutex);
  if (!lock.isLocked()) return WaypointHandle(0);
  if (!m_config.logToTerminal.load() && !m_config.logToSD.load()) return WaypointHandle(0);

  WPId id = m_nextId++;
  InternalWaypoint wp;
  wp.id = id;
  wp.name = std::move(name);
  wp.startTimeMs = pros::millis();
  wp.active = true;
  wp.timedOut = false;

  if (details.tarT.has_value() && !details.thetaTol.has_value()) 
    details.thetaTol = details.linearTol;

  if (!details.tarT.has_value() && details.thetaTol.has_value())
    details.thetaTol = std::nullopt;

  wp.params = details;

  m_waypoints.push_back(std::move(wp));

  if (!m_config.printWaypoints.load()) return WaypointHandle(id);

  if (m_config.logToTerminal.load()) {
    detail::Telemetry::getInstance().sendRoster(id, m_waypoints.back().name);

    detail::WaypointCreatedPacket pkt;
    pkt.timestamp = static_cast<uint16_t>(pros::millis());
    pkt.id = id;
    pkt.tarX = static_cast<float>(details.tarX);
    pkt.tarY = static_cast<float>(details.tarY);
    pkt.tarT = detail::packTelemetryTheta(details.tarT.value_or(0.0));
    pkt.linTol = details.linearTol;
    pkt.thetaTol = details.thetaTol.has_value()
      ? details.thetaTol.value()
      : std::numeric_limits<float>::quiet_NaN();
    pkt.timeout = details.timeoutMs.value_or(0);
    detail::Telemetry::getInstance().sendWaypointCreated(pkt);
  }

  if (m_config.logToSD.load()) {
    logToSD(LogLevel::OVERRIDE, "[WPOINT],%d,CREATED,%d,%s,%s",
            pros::millis(), id, m_waypoints.back().name.c_str(), 
            formatParams(details).c_str());
  }
  return WaypointHandle(id);
}

std::optional<std::string> Logger::m_getRosterNameUnlocked(uint16_t id, bool isElevated) const {
  if (const InternalWaypoint* waypoint = m_findWaypointUnlocked(id)) return waypoint->name;
  return m_getWatchNameUnlocked(id, isElevated);
}

bool Logger::resyncWaypointRoster(WPId id) {
  detail::uniqueLock lock(m_mutex);
  if (!lock.isLocked()) return false;
  if (m_waypoints.empty() || !m_config.logToTerminal.load()) return false;

  InternalWaypoint* waypoint = m_findWaypointUnlocked(id);
  if (!waypoint || !waypoint->active) return false;

  detail::Telemetry::getInstance().sendRoster(waypoint->id, waypoint->name);
  m_lastRosterFlush = pros::millis();
  return true;
}

void Logger::resyncAllWaypointsRoster() {
  detail::uniqueLock lock(m_mutex);
  if (!lock.isLocked()) return;
  if (m_waypoints.empty() || !m_config.logToTerminal.load()) return;

  for (const auto& wp : m_waypoints) {
    if (!wp.active) continue;
    detail::Telemetry::getInstance().sendRoster(wp.id, wp.name);
  }
  m_lastRosterFlush = pros::millis();
}
} // namespace mvlib
