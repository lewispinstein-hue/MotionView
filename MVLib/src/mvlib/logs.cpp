#include "mvlib/core.hpp"
#include "mvlib/private/telemetry.hpp"
#include <cstdarg>

namespace mvlib {
void Logger::logMessage(const LogLevel level, const char *fmt, va_list args) {
  // Check global filter first
  if (!detail::Telemetry::getInstance().shouldLog(level)) return;

  char buffer[1024];
  vsnprintf(buffer, sizeof(buffer), fmt, args);

  if (m_config.logToTerminal.load()) {
    detail::Telemetry::getInstance().sendLog(level, "%s", buffer);
  }

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    logToSD(level, "[LOG],%d,%s,%s", pros::millis(), levelToString(level), buffer);
  }
}

void Logger::debug(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::DEBUG)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::DEBUG, fmt, args);
  va_end(args);
}

void Logger::info(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::INFO)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::INFO, fmt, args);
  va_end(args);
}

void Logger::warn(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::WARN)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::WARN, fmt, args);
  va_end(args);
}

void Logger::error(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::ERROR)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::ERROR, fmt, args);
  va_end(args);
}

void Logger::fatal(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::FATAL)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::FATAL, fmt, args);
  va_end(args);
}
} // namespace mvlib
