#include "mvlib/core.hpp"
#include "mvlib/private/terminalOut.hpp"
#include "mvlib/private/sdCsv.hpp"
#include <cstdarg>

namespace mvlib {
void Logger::logMessage(const LogLevel level, detail::LogSource source, const char *fmt, va_list args) {
  // Check global filter first
  if (!detail::Telemetry::getInstance().shouldLog(level)) return;
  if (source == detail::LogSource::SYSTEM && !m_config.logSystemInfo.load()) return;

  char buffer[1024];
  vsnprintf(buffer, sizeof(buffer), fmt, args);

  if (m_config.logToTerminal.load()) {
    detail::Telemetry::getInstance().sendLog(level, source, "%s", buffer);
  }

  if (m_config.logToSD.load()) {
    // The frontend joins everything after the 3rd comma back into the
    // message, so commas already round-trip; only a line break needs
    // neutralizing to keep the record on one line.
    detail::stripSdLineBreaks(buffer);
    const char* sourceStr = source == detail::LogSource::SYSTEM ? "[MVLIB] " : "";
    logToSD(level, "[LOG],%d,%s,%s%s", pros::millis(), levelToString(level), sourceStr, buffer);
  }
}

void Logger::logMessage(const LogLevel level, detail::LogSource source, const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  logMessage(level, source, fmt, args);
  va_end(args);
}

void Logger::debug(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::DEBUG)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::DEBUG, detail::LogSource::USER, fmt, args);
  va_end(args);
}

void Logger::info(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::INFO)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::INFO, detail::LogSource::USER, fmt, args);
  va_end(args);
}

void Logger::warn(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::WARN)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::WARN, detail::LogSource::USER, fmt, args);
  va_end(args);
}

void Logger::error(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::ERROR)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::ERROR, detail::LogSource::USER, fmt, args);
  va_end(args);
}

void Logger::fatal(const char *fmt, ...) {
  if (!detail::Telemetry::getInstance().shouldLog(LogLevel::FATAL)) return;

  va_list args;
  va_start(args, fmt);
  logMessage(LogLevel::FATAL, detail::LogSource::USER, fmt, args);
  va_end(args);
}
} // namespace mvlib
