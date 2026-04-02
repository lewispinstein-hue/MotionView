#include "mvlib/core.hpp"
#include "mvlib/logMacros.h"

#ifdef MVLIB_LOGS_REDEFINED
#undef LOG_DEBUG
#undef LOG_INFO
#undef LOG_WARN
#undef LOG_ERROR
#undef LOG_FATAL

#define LOG_DEBUG MVLIB_LOG_DEBUG
#define LOG_INFO MVLIB_LOG_INFO
#define LOG_WARN MVLIB_LOG_WARN
#define LOG_ERROR MVLIB_LOG_ERROR
#define LOG_FATAL MVLIB_LOG_FATAL
#endif

namespace mvlib {
void Logger::printWatches() {
  uint32_t nowMs = pros::millis();
  for (auto &[id, w] : m_watches) {
    // Gate evaluation frequency for not onChange watches
    if (!w.onChange && w.lastPrintMs != 0 &&
       (nowMs - w.lastPrintMs) < w.intervalMs) continue;

    if (!w.eval) continue;

    auto [lvl, valueStr, label] = w.eval();
    if (lvl == LogLevel::NONE || lvl == LogLevel::OFF) continue;
    
    if (w.onChange) {
      if (w.lastValue && *w.lastValue == valueStr) continue;
      w.lastValue = valueStr;
    } else if (!w.onChange) w.lastPrintMs = nowMs;
    
    // Add watch tag and add comma separators
    label = std::string("[WATCH],") +
            std::to_string(nowMs) + 
            "," + m_levelToString(lvl) 
            + "," + std::to_string(id)
            +  "," + label + "," + valueStr;

    switch (lvl) {
      case LogLevel::DEBUG: LOG_DEBUG("%s", label.c_str()); break;
      case LogLevel::INFO:  LOG_INFO("%s",  label.c_str()); break;
      case LogLevel::WARN:  LOG_WARN("%s",  label.c_str()); break;
      case LogLevel::ERROR: LOG_ERROR("%s", label.c_str()); break;
      default:              LOG_INFO("%s",  label.c_str()); break;
    }
  }
}
} // namespace mvlib
