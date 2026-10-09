#include "mvlib/core.hpp"

namespace mvlib {
const char* Logger::levelToString(LogLevel level) const {
  switch (level) {
    case LogLevel::DEBUG:    return "DEBUG";
    case LogLevel::INFO:     return "INFO";
    case LogLevel::WARN:     return "WARN";
    case LogLevel::ERROR:    return "ERROR";
    case LogLevel::FATAL:    return "FATAL";
    case LogLevel::OVERRIDE: return "OVERRIDE";
    default:                 return "UNKNOWN";
  }
  __builtin_unreachable();
}

bool Logger::configValid() const {
  return (m_pLeftDrivetrain && m_pRightDrivetrain) && m_configSet.load();
}
} // namespace mvlib
