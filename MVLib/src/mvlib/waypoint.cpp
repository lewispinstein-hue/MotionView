#include "mvlib/core.hpp"
#include "mvlib/waypoint.hpp"
#include "mvlib/logMacros.h"
#include "math.h"
#include <cstdio> 
#include <inttypes.h>
#include <string>
#include <algorithm>

#ifdef MVLIB_LOGS_REDEFINED
#undef LOG_INFO
#define LOG_INFO MVLIB_LOG_INFO
#endif

namespace mvlib {
WaypointOffset Logger::getWaypointOffset(WPId id) {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                         [id](const InternalWaypoint& ic) { return ic.id == id; });
  
  if (it == m_waypoints.end() || !it->active) return {};

  WaypointOffset offset;
  auto pose = m_getPose ? m_getPose() : std::nullopt;
  if (!pose) return {};

  // Linear Offsets
  offset.offX = it->params.tarX - pose->x;
  offset.offY = it->params.tarY - pose->y; 
  offset.totalOffset = sqrt(offset.offX * offset.offX + offset.offY * offset.offY);

  // Angular Offset (Wrapped to [-180, 180])
  if (it->params.tarT.has_value()) {
    double error = it->params.tarT.value() - pose->theta;
    error = fmod(error + 180.0, 360.0);
    if (error < 0) error += 360.0;
    offset.offT = error - 180.0;
  }

  // Timeout Evaluation
  if (it->params.timeoutMs.has_value()) {
    uint32_t elapsed = pros::millis() - it->startTimeMs;
    if (elapsed >= it->params.timeoutMs.value()) {
      offset.timedOut = true;
      offset.remainingTimeout = 0;
    } else {
      offset.remainingTimeout = it->params.timeoutMs.value() - elapsed;
      offset.timedOut = false;
    }
  } else {
    offset.remainingTimeout = std::nullopt;
    offset.timedOut = false;
  }

  // Reached Logic
  bool linearReached = offset.totalOffset <= it->params.linearTol;
  bool angularReached = !it->params.thetaTol.has_value() || 
                        (offset.offT.has_value() && 
                        std::abs(offset.offT.value()) <= it->params.thetaTol.value());

  offset.reached = (linearReached && angularReached);
  return offset;
}

WaypointParams Logger::getWaypointParams(WPId id) {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                          [id](const InternalWaypoint& ic) { return ic.id == id; });
  if (it == m_waypoints.end()) return {};
  return it->params;
}

bool Logger::isWaypointReached(WPId id) {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                         [id](const InternalWaypoint& wp) { return wp.id == id; });
  
  if (it == m_waypoints.end() || !it->active) return false;

  WaypointOffset offset = getWaypointOffset(id);
  return offset.reached;
}

std::string Logger::getWaypointName(WPId id) {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                          [id](const InternalWaypoint& ic) { return ic.id == id; });
  return (it != m_waypoints.end()) ? it->name : "";
}

bool Logger::isPrevReached(WPId id) {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                          [id](const InternalWaypoint& ic) { return ic.id == id; });
  return (it != m_waypoints.end()) ? it->prevReached : false;
}

bool Logger::setPrevReached(WPId id, bool reached) {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                          [id](const InternalWaypoint& ic) { return ic.id == id; });
  if (it == m_waypoints.end()) return false;
  it->prevReached = reached;
  return true;
}

static std::string formatParams(const WaypointParams& params) {
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

WaypointHandle Logger::addWaypoint(std::string name, WaypointParams details) {
  unique_lock lock(m_mutex);

  WPId id = m_nextId++;
  InternalWaypoint wp;
  wp.id = id;
  wp.name = std::move(name);
  wp.startTimeMs = pros::millis();
  wp.active = true;

  if (details.tarT.has_value() && !details.thetaTol.has_value()) 
    details.thetaTol = details.linearTol;

  if (!details.tarT.has_value() && details.thetaTol.has_value())
   details.thetaTol = std::nullopt;

  wp.params = details;

  // Use the ID before moving wp into the vector
  m_waypoints.push_back(std::move(wp));

  LOG_INFO("[WPOINT],%d,CREATED,%" PRIu64 ",%s,%s",
           pros::millis(), id, m_waypoints.back().name.c_str(), 
           formatParams(details).c_str());
  return WaypointHandle(id);
}

bool Logger::isWaypointActive(WPId id) {
  auto it = std::find_if(m_waypoints.begin(), m_waypoints.end(),
                          [id](const InternalWaypoint& ic) { return ic.id == id; });
  return (it != m_waypoints.end()) && it->active;
}
} // namespace mvlib