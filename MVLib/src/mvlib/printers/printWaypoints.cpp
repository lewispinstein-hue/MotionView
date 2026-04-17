#include "mvlib/core.hpp"
#include "mvlib/telemetry.hpp"
#include <cmath>

namespace mvlib {

void Logger::printWaypoints() {
  unique_lock lock(m_mutex);
  if (!lock.isLocked()) return;

  uint32_t nowMs = pros::millis();

  auto pose = m_getPose ? m_getPose() : std::nullopt;

  for (auto& wp : m_waypoints) {
    if (!wp.active) continue;

    WaypointOffset off{};
    if (pose) {
      off.offX = wp.params.tarX - pose->x;
      off.offY = wp.params.tarY - pose->y;
      off.totalOffset = std::sqrt(off.offX * off.offX + off.offY * off.offY);

      if (wp.params.tarT.has_value()) {
        double error = wp.params.tarT.value() - pose->theta;
        error = std::fmod(error + 180.0, 360.0);
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
    }
    
    uint8_t subType = 0;
    bool shouldTrigger = false;
    const char* statusStr = nullptr;

    if (off.reached && (!wp.prevReached || !wp.params.retriggerable)) {
      subType = 2; // REACHED
      statusStr = "REACHED";
      shouldTrigger = true;
      wp.prevReached = true;
      wp.active = wp.params.retriggerable;
    } else if (!off.reached && wp.prevReached) {
      wp.prevReached = false;
    } else if (off.timedOut.value_or(false)) {
      subType = 3; // TIMEDOUT
      statusStr = "TIMEDOUT";
      shouldTrigger = true;
      wp.active = false;
    }

    if (!shouldTrigger) continue;

    // Send binary through terminal
    if (m_config.logToTerminal.load()) {
      Telemetry::getInstance().sendWaypointStatus(wp.id, subType);
    }

    // Log standard ANSII to the sd card
    if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
      logToSD(LogLevel::OVERRIDE, "[WPOINT],%u,%s,%u,%s",
              nowMs, statusStr, wp.id, wp.name.c_str());
    }
  }
}
} // namespace mvlib
