#include "mvlib/core.hpp"
#include "mvlib/private/telemetry.hpp"
#include "mvlib/private/raii.hpp"
#include <cerrno>
#include <cmath>
#include <cstdlib>

namespace mvlib {
void Logger::printWatches() {
  size_t index = 0;

  while (true) {
    // Copies of all variables
    WatchId watchId{};
    std::shared_ptr<std::function<std::tuple<LogLevel, std::string, std::string, bool>()>> eval;
    std::shared_ptr<pros::Mutex> evalMutex;

    {
      // Lock mutex only while copying variables
      detail::uniqueLock lock(m_mutex);
      if (!lock.isLocked()) return;
      if (index >= m_watches.size()) break;

      auto& watch = m_watches[index++];
      const uint32_t nowMs = pros::millis();

      if (!watch.active || !watch.eval || !watch.evalMutex) continue;
      if (!watch.onChange && watch.lastPrintMs != 0 &&
          (nowMs - watch.lastPrintMs) < watch.intervalMs) continue;

      watchId = watch.id;
      eval = watch.eval;
      evalMutex = watch.evalMutex;
    }

    detail::uniqueLock callbackLock(*evalMutex, TIMEOUT_MAX);
    if (!callbackLock.isLocked()) continue;

    auto [lvl, valueStr, label, tripped] = (*eval)();
    const uint32_t nowMs = pros::millis();

    {
      detail::uniqueLock lock(m_mutex);
      if (!lock.isLocked()) return;

      InternalWatch* watch = m_findWatchUnlocked(watchId);
      if (!watch || !watch->active) continue;

      if (watch->onChange) {
        if (watch->lastValue.has_value() && watch->lastValue.value() == valueStr) {
          continue;
        } else if (watch->lastPrintMs != 0 && (nowMs - watch->lastPrintMs) < watch->intervalMs) {
          continue;
        } else {
          watch->lastValue = valueStr;
          watch->lastPrintMs = nowMs;
        }
      } else {
        if (watch->lastPrintMs != 0 && (nowMs - watch->lastPrintMs) < watch->intervalMs) {
          continue;
        } else {
          watch->lastPrintMs = nowMs;
        }
      }
    }

    if (m_config.logToTerminal.load()) {
      bool sentAsBinary = false;
      
      // Prefer the compact binary watch packet when the rendered value is a pure float.
      if (!valueStr.empty()) {
        char* end = nullptr;
        errno = 0;
        const float numericVal = std::strtof(valueStr.c_str(), &end);
        if (end != valueStr.c_str() && end != nullptr && *end == '\0' &&
            errno != ERANGE && std::isfinite(numericVal)) {
          detail::Telemetry::getInstance().sendWatch(watchId, lvl, numericVal, tripped);
          sentAsBinary = true;
        }
      }

      // Non-numeric watches still use the structured binary watch channel.
      if (!sentAsBinary) {
        detail::Telemetry::getInstance().sendWatchText(watchId, lvl, valueStr, tripped);
      }
    }

    // Log standard ANSII to the sd card
    if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
      // Uncompress t/f to true/false
      if (valueStr == "f") valueStr = "false";
      if (valueStr == "t") valueStr = "true";

      logToSD(lvl, "[WATCH],%u,%s,%u,%s,%s", nowMs, 
              levelToString(lvl), watchId, label.c_str(), valueStr.c_str());
    }
  }
}
} // namespace mvlib
