#include "mvlib/waypoint.hpp"
#include "mvlib/core.hpp"

namespace mvlib {
WaypointOffset WaypointHandle::getOffset() const {
  return Logger::getInstance().getWaypointOffset(this->m_id);
}

WaypointParams WaypointHandle::getParams() const {
  return Logger::getInstance().getWaypointParams(this->m_id);
}

bool WaypointHandle::reached() const {
  return Logger::getInstance().isWaypointReached(this->m_id); 
}

std::string WaypointHandle::getLabel() const {
  return Logger::getInstance().getWaypointName(this->m_id);
}

bool WaypointHandle::timedOut() const {
  return Logger::getInstance().getWaypointOffset(this->m_id).timedOut.value_or(false);
}

bool WaypointHandle::active() const {
  return Logger::getInstance().isWaypointActive(this->m_id);
}
} // namespace mvlib
