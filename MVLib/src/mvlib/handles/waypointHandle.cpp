#include "mvlib/waypoint.hpp"
#include "mvlib/core.hpp"
#include "mvlib/private/raii.hpp"

namespace mvlib {
WaypointOffset WaypointHandle::getOffset() const {
  return Logger::getInstance().getWaypointOffset(this->m_id);
}

WaypointParams WaypointHandle::getParams() const {
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_waypoints.empty()) return {};

  const Logger::InternalWaypoint* waypoint = logger.m_findWaypointUnlocked(this->m_id);
  return waypoint ? waypoint->params : WaypointParams{};
}

bool WaypointHandle::reached() const {
  return Logger::getInstance().isWaypointReached(this->m_id); 
}

std::string WaypointHandle::getLabel() const {
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_waypoints.empty()) return {};

  const Logger::InternalWaypoint* waypoint = logger.m_findWaypointUnlocked(this->m_id);
  return waypoint ? waypoint->name : std::string{};
}

bool WaypointHandle::timedOut() const {
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_waypoints.empty()) return false;

  const Logger::InternalWaypoint* waypoint = logger.m_findWaypointUnlocked(this->m_id);
  if (!waypoint) return false;

  auto* mutableWaypoint = const_cast<Logger::InternalWaypoint*>(waypoint);

  // Do timeout check
  if (mutableWaypoint->params.timeoutMs.has_value() &&
      (pros::millis() - mutableWaypoint->startTimeMs >=
       mutableWaypoint->params.timeoutMs.value())) {
    return true;
  }
  return false;
}

bool WaypointHandle::active() const {
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_waypoints.empty()) return false;

  const Logger::InternalWaypoint* waypoint = logger.m_findWaypointUnlocked(this->m_id);
  return waypoint ? waypoint->active : false;
}

bool WaypointHandle::resyncRoster() const {
  return Logger::getInstance().resyncWaypointRoster(this->m_id);
}
} // namespace mvlib
