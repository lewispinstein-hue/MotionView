#include "mvlib/core.hpp"
#include "mvlib/private/terminalOut.hpp"
#include "mvlib/private/raii.hpp"
#include "mvlib/private/sdCsv.hpp"
#include <cmath>
#include <vector>

namespace mvlib {

void Logger::printWaypoints() {
  uint32_t nowMs = pros::millis();
  std::shared_ptr<std::function<std::optional<Pose>()>> poseGetter;
  std::shared_ptr<pros::Mutex> poseGetterMutex;

  {
    detail::uniqueLock lock(m_mutex, TIMEOUT_MAX);
    if (!lock.isLocked()) return;
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

  struct TriggeredEvent {
    WPId id;
    uint8_t subType;
    const char* status;
    std::string name;
  };
  std::vector<TriggeredEvent> triggered;

  {
    detail::uniqueLock lock(m_mutex, TIMEOUT_MAX);
    if (!lock.isLocked() || m_waypoints.empty()) return;

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

      const bool hasTimeout = wp.params.timeoutMs.has_value();
      const uint32_t elapsed = nowMs - wp.startTimeMs;
      const bool expired = hasTimeout && elapsed >= wp.params.timeoutMs.value();

      if (hasTimeout) {
        off.remainingTimeout = expired ? 0 : wp.params.timeoutMs.value() - elapsed;
        off.timedOut = expired;
      } else {
        off.remainingTimeout = std::nullopt;
        off.timedOut = false;
      }

      uint8_t subType = 0;
      bool shouldTrigger = false;
      const char* status = nullptr;

      if (expired) {
        subType = 3; // TIMEDOUT
        status = "TIMEDOUT";
        shouldTrigger = true;
        wp.timedOut = true;
        wp.active = false;
      } else if (off.reached && (!wp.prevReached || !wp.params.retriggerable)) {
        subType = 2; // REACHED
        status = "REACHED";
        shouldTrigger = true;
        wp.prevReached = true;
        wp.timedOut = false;
        wp.reached = true;
        wp.active = wp.params.retriggerable;
      } else if (!off.reached && wp.prevReached) {
        wp.prevReached = false;
        wp.timedOut = false;
      } else {
        wp.timedOut = false;
      }

      if (shouldTrigger && m_config.printWaypoints.load()) {
        triggered.push_back({wp.id, subType, status, wp.name});
      }
    }
  }

  // Terminal and SD writes can block. Keep them out of m_mutex so public
  // handle accessors only wait for state updates, never for I/O.
  for (const auto& event : triggered) {
    if (ensureTerminalSession()) {
      detail::Telemetry::getInstance().sendWaypointStatus(event.id, event.subType);
    }
    if (m_config.logToSD.load()) {
      logToSD(LogLevel::OVERRIDE, "[WPOINT],%u,%s,%u,%s", nowMs,
              event.status ? event.status : "", event.id,
              detail::escapeSdCsvField(event.name).c_str());
    }
  }
}
} // namespace mvlib
