#include "mvlib/core.hpp"
#include <inttypes.h>

namespace mvlib {
void Logger::printWatches() {
  unique_lock lock(m_mutex);
  if (!lock.isLocked()) return; // Ensure the vector won't be resized  

  uint32_t nowMs = pros::millis();
  for (auto& w : m_watches) {
    // Gate evaluation frequency for not onChange watches
    if (!w.onChange && w.lastPrintMs != 0 &&
       (nowMs - w.lastPrintMs) < w.intervalMs) continue;

    if (!w.eval) continue;

    auto [lvl, valueStr, label] = w.eval();

    if (w.onChange) {
      if (w.lastValue && *w.lastValue == valueStr) continue;
      w.lastValue = valueStr;
    } else if (!w.onChange) w.lastPrintMs = nowMs;

    logMessage(lvl, "[WATCH],%d,%s,%" PRIu64 ",%s,%s", nowMs,  
               m_levelToString(lvl), w.id, label.c_str(), valueStr.c_str());
  }
}
} // namespace mvlib
