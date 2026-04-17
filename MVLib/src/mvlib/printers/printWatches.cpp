#include "mvlib/core.hpp"
#include "mvlib/telemetry.hpp"
#include <cerrno>
#include <cmath>
#include <cstdlib>

namespace mvlib {

void Logger::printWatches() {
  unique_lock lock(m_mutex);
  if (!lock.isLocked()) return;

  uint32_t nowMs = pros::millis();

  for (auto& w : m_watches) {
    // Frequency gating
    if (!w.onChange && w.lastPrintMs != 0 && (nowMs - w.lastPrintMs) < w.intervalMs) {
      continue;
    }

    if (!w.eval) continue;

    auto [lvl, valueStr, label, tripped] = w.eval();

    // Change detection
    if (w.onChange) {
      if (w.lastValue && *w.lastValue == valueStr) continue;
      w.lastValue = valueStr;
    } else {
      w.lastPrintMs = nowMs;
    }

    // --- 2. Terminal Dispatch (Binary Hex) ---
    if (m_config.logToTerminal.load()) {
      bool sentAsBinary = false;
      
      // Prefer the compact binary watch packet when the rendered value is a pure float.
      if (!valueStr.empty()) {
        char* end = nullptr;
        errno = 0;
        const float numericVal = std::strtof(valueStr.c_str(), &end);
        if (end != valueStr.c_str() && end != nullptr && *end == '\0' &&
            errno != ERANGE && std::isfinite(numericVal)) {
          Telemetry::getInstance().sendWatch(w.id, lvl, numericVal, tripped);
          sentAsBinary = true;
        }
      }

      // Non-numeric watches still use the structured binary watch channel.
      if (!sentAsBinary) {
        Telemetry::getInstance().sendWatchText(w.id, lvl, valueStr, tripped);
      }
    }

    // Log standard ANSII to the sd card
    if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
      logToSD(lvl, "[WATCH],%u,%s,%u,%s,%s", 
              nowMs, m_levelToString(lvl), w.id, label.c_str(), valueStr.c_str());
    }
  }
}
} // namespace mvlib
