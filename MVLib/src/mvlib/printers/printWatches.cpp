#include "mvlib/core.hpp"
#include "mvlib/private/telemetry.hpp"
#include "mvlib/private/raii.hpp"
#include <cerrno>
#include <cmath>
#include <cstdlib>

namespace mvlib {
void Logger::printWatches() {
  detail::uniqueLock lock(m_mutex);
  if (!lock.isLocked()) return;

  uint32_t nowMs = pros::millis();

  for (auto& watch : m_watches) {
    if (!watch.active || !watch.eval) continue;
    if (!watch.onChange && watch.lastPrintMs != 0 &&
        (nowMs - watch.lastPrintMs) < watch.intervalMs) continue;

    auto [lvl, valueStr, label, tripped] = watch.eval();

    if (watch.onChange) {
      if (watch.lastValue.has_value() && watch.lastValue.value() == valueStr) {
        // No change
        continue;
      } else if (watch.lastPrintMs != 0 && (nowMs - watch.lastPrintMs) < watch.intervalMs) {
        // Debounce
        continue;
      } else {
        // Update
        watch.lastValue = valueStr;
        watch.lastPrintMs = nowMs;
      }
    } else {
      if (watch.lastPrintMs != 0 && (nowMs - watch.lastPrintMs) < watch.intervalMs) {
        // Non onChange debounce
        continue;
      } else {
        watch.lastPrintMs = nowMs;
      }
    }

    if (m_config.logToTerminal.load()) {
      bool sentAsBinary = false;
      
      // Prefer the compact binary watch packet when the rendered value is a pure float.
      if (!valueStr.empty()) {
        char *end = nullptr;
        errno = 0;
        const float numericVal = std::strtof(valueStr.c_str(), &end);
        if (end != valueStr.c_str() && end != nullptr && *end == '\0' &&
            errno != ERANGE && std::isfinite(numericVal)) {
          detail::Telemetry::getInstance().sendWatch(watch.id, lvl, numericVal, tripped);
          sentAsBinary = true;
        }
      }

      // Non-numeric watches still use the structured binary watch channel.
      if (!sentAsBinary) {
        detail::Telemetry::getInstance().sendWatchText(watch.id, lvl, valueStr, tripped);
      }
    }

    // Log standard ANSII to the sd card
    if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
      // Uncompress t/f to true/false
      if (valueStr == "f") valueStr = "false";
      if (valueStr == "t") valueStr = "true";

      logToSD(lvl, "[WATCH],%u,%s,%u,%s,%s", nowMs, 
              levelToString(lvl), watch.id, label.c_str(), valueStr.c_str());
    }
  }
}
} // namespace mvlib
