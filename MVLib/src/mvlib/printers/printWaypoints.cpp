#include "mvlib/core.hpp"
#include "mvlib/logMacros.h"
#include <inttypes.h>

#ifdef MVLIB_LOGS_REDEFINED
#undef LOG_INFO

#define LOG_INFO MVLIB_LOG_INFO
#endif

namespace mvlib {
void Logger::printWaypoints() {
  unique_lock lock(m_mutex);
  if (!lock.isLocked()) return;

  uint32_t nowMs = pros::millis();
  char buffer[256];
  
  for (auto& wp : m_waypoints) {
    if (!wp.active) continue; 

    WaypointOffset off = getWaypointOffset(wp.id);
    bool perpetual = wp.params.retriggerable;
    bool prevReached = isPrevReached(wp.id);
    std::optional<uint32_t> printEveryMs = wp.params.logOffsetEveryMs;
    
    snprintf(buffer, sizeof(buffer), "%.2f,%.2f,%.2f,%d",
              off.offX, off.offY,
              off.offT.value_or(0.0), off.remainingTimeout.value_or(0));
              
    if ((off.reached && !prevReached) || (off.reached && !perpetual)) {
      LOG_INFO("[WPOINT],%u,REACHED,%" PRIu64 ",%s,%s", nowMs, wp.id, wp.name.c_str(), buffer);
      prevReached = true;
      wp.active = !perpetual; // Dynamic based on if perpetual
    } else if (!off.reached && prevReached) {
      prevReached = false;
    } else if (off.timedOut.value_or(false)) {
      LOG_INFO("[WPOINT],%u,TIMEDOUT,%" PRIu64 ",%s,%s", nowMs, wp.id, wp.name.c_str(), buffer);
      wp.active = false;
    } else if (printEveryMs.has_value() && nowMs - wp.lastPrintMs >= printEveryMs.value()) {
      LOG_INFO("[WPOINT],%u,OFFSET,%" PRIu64 ",%s,%s",
              nowMs, wp.id, wp.name.c_str(), buffer);      
      wp.lastPrintMs = nowMs;
    }
    setPrevReached(wp.id, prevReached);
  }
}
} // namespace mvlib