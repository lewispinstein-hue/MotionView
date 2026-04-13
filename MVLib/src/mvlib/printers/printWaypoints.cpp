#include "mvlib/core.hpp"
#include <inttypes.h>
#include <cmath>

#ifdef MVLIB_LOGS_REDEFINED
#undef LOG_INFO

#define LOG_INFO MVLIB_LOG_INFO
#endif

namespace mvlib {
static int formatOffset(char *buf, size_t len, const WaypointOffset& off) {
  if (!buf) return -1;
  if (len < 128) return -2;

  snprintf(buf, len, "%.2f,%.2f,%s,%s",
           off.offX, off.offY,
           off.offT.has_value() ? std::to_string(off.offT.value()).c_str() : "NA",
           off.remainingTimeout.has_value() ? std::to_string(off.remainingTimeout.value()).c_str() : "NA");

  return 0;
}

void Logger::printWaypoints() {
  unique_lock lock(m_mutex);
  if (!lock.isLocked()) return; // Safe: we own the lock now
  
  uint32_t nowMs = pros::millis();
  char buffer[256];
  
  // Get pose once per loop to save overhead
  auto pose = m_getPose ? m_getPose() : std::nullopt;
  
  for (auto& wp : m_waypoints) {
    if (!wp.active) continue; 

    WaypointOffset off{};
    if (pose) {
      off.offX = wp.params.tarX - pose->x;
      off.offY = wp.params.tarY - pose->y; 
      off.totalOffset = sqrt(off.offX * off.offX + off.offY * off.offY);

      if (wp.params.tarT.has_value()) {
        double error = wp.params.tarT.value() - pose->theta;
        error = fmod(error + 180.0, 360.0);
        if (error < 0) error += 360.0;
        off.offT = error - 180.0;
      }
      
      bool linearReached = off.totalOffset <= wp.params.linearTol;
      bool angularReached = !wp.params.thetaTol.has_value() || 
                            (off.offT.has_value() && std::abs(off.offT.value()) <= wp.params.thetaTol.value());
      off.reached = (linearReached && angularReached);
    }

    if (wp.params.timeoutMs.has_value()) {
      uint32_t elapsed = nowMs - wp.startTimeMs;
      if (elapsed >= wp.params.timeoutMs.value()) {
        off.timedOut = true;
        off.remainingTimeout = 0;
      } else {
        off.remainingTimeout = wp.params.timeoutMs.value() - elapsed;
        off.timedOut = false;
      }
    } else {
      off.remainingTimeout = std::nullopt;
      off.timedOut = false;
    }

    bool perpetual = wp.params.retriggerable;
    std::optional<uint32_t> printEveryMs = wp.params.logOffsetEveryMs;
    
    if (formatOffset(buffer, sizeof(buffer), off) < 0) continue;
              
    if ((off.reached && !wp.prevReached) || (off.reached && !perpetual)) {
      logMessage(LogLevel::OVERRIDE, "[WPOINT],%u,REACHED,%" PRIu64 ",%s,%s", nowMs, wp.id, wp.name.c_str(), buffer);
      wp.prevReached = true;
      wp.active = perpetual; 
    } else if (!off.reached && wp.prevReached) {
      wp.prevReached = false;
    } else if (off.timedOut.value_or(false)) {
      logMessage(LogLevel::OVERRIDE, "[WPOINT],%u,TIMEDOUT,%" PRIu64 ",%s,%s", nowMs, wp.id, wp.name.c_str(), buffer);
      wp.active = false;
    } else if (printEveryMs.has_value() && nowMs - wp.lastPrintMs >= printEveryMs.value()) {
      logMessage(LogLevel::OVERRIDE, "[WPOINT],%u,OFFSET,%" PRIu64 ",%s,%s", nowMs, wp.id, wp.name.c_str(), buffer);      
      wp.lastPrintMs = nowMs;
    }
  }
}
} // namespace mvlib