#include "pros/rtos.hpp"
#include "mvlib/core.hpp"
#include <cstdarg>

namespace mvlib {

const char *Logger::m_levelToString(const LogLevel& level) const {
  switch (level) {
  case LogLevel::DEBUG:              return "DEBUG";
  case LogLevel::INFO:               return "INFO";
  case LogLevel::WARN:               return "WARN";
  case LogLevel::ERROR:              return "ERROR";
  case LogLevel::FATAL:              return "FATAL";
  case LogLevel::TELEMETRY_OVERRIDE: return "INFO";
  case LogLevel::OVERRIDE:           return "OVERRIDE";
  default:                           return "UNKNOWN";
  }
  _MVLIB_UNREACHABLE();
}

void Logger::logMessage(LogLevel level, const char *fmt, ...) {
  if (level < m_minLogLevel || (int)level <= 0 || !(int)m_minLogLevel) return;

  unique_lock m(m_terminalMutex);
  if (!m.isLocked()) return;

  char buffer[1024];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  double time = pros::millis() / 1000.0;
  if (m_config.logToTerminal.load()) 
    printf("[%.2f] [%s]: %s\n", time, m_levelToString(level), buffer);

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    // Minimize recursion; don't call unless can log
    logToSD(m_levelToString(level), "%s", buffer);
  }
}
} // namespace mvlib