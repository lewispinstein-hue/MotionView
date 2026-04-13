#include "mvlib/core.hpp"

namespace mvlib {
const char *Logger::m_levelToString(const LogLevel& level) const {
  switch (level) {
  case LogLevel::DEBUG:    return "DEBUG";
  case LogLevel::INFO:     return "INFO";
  case LogLevel::WARN:     return "WARN";
  case LogLevel::ERROR:    return "ERROR";
  case LogLevel::FATAL:    return "FATAL";
  case LogLevel::OVERRIDE: return "OVERRIDE";
  default:                 return "UNKNOWN";
  }
  _MVLIB_UNREACHABLE();
}
} // namespace mvlib
