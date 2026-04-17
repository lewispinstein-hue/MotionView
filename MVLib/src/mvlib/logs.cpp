#include "mvlib/core.hpp"
#include "mvlib/telemetry.hpp"
#include <cstdarg>

namespace mvlib {
void Logger::debug(const char *fmt, ...) {
  if (!Telemetry::getInstance().shouldLog(LogLevel::DEBUG)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::DEBUG, fmt, args);
  va_end(args);
}

void Logger::info(const char *fmt, ...) {
  if (!Telemetry::getInstance().shouldLog(LogLevel::INFO)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::INFO, fmt, args);
  va_end(args);
}

void Logger::warn(const char *fmt, ...) {
  if (!Telemetry::getInstance().shouldLog(LogLevel::WARN)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::WARN, fmt, args);
  va_end(args);
}

void Logger::error(const char *fmt, ...) {
  if (!Telemetry::getInstance().shouldLog(LogLevel::ERROR)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::ERROR, fmt, args);
  va_end(args);
}

void Logger::fatal(const char *fmt, ...) {
  if (!Telemetry::getInstance().shouldLog(LogLevel::FATAL)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::FATAL, fmt, args);
  va_end(args);
}
} // namespace mvlib
