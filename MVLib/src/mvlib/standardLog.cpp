#include "mvlib/core.hpp"
#include <cstdarg>

namespace mvlib {
// Format: [LOG],uptime,lvl,message
void Logger::debug(const char *fmt, ...) {
  if ((uint8_t)LogLevel::DEBUG < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  logMessage(LogLevel::DEBUG, "[LOG],%d,DEBUG,%s", time, buffer);
}

void Logger::info(const char *fmt, ...) {
  if ((uint8_t)LogLevel::INFO < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  logMessage(LogLevel::INFO, "[LOG],%d,INFO,%s", time, buffer);
}

void Logger::warn(const char *fmt, ...) {
  if ((uint8_t)LogLevel::WARN < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  logMessage(LogLevel::WARN, "[LOG],%d,WARN,%s", time, buffer);
}

void Logger::error(const char *fmt, ...) {
  if ((uint8_t)LogLevel::ERROR < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  logMessage(LogLevel::ERROR, "[LOG],%d,ERROR,%s", time, buffer);
} 

void Logger::fatal(const char *fmt, ...) {
  if ((uint8_t)LogLevel::FATAL < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  logMessage(LogLevel::FATAL, "[LOG],%d,FATAL,%s", time, buffer);
} 
} // namespace mvlib
