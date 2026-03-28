#include "mvlib/core.hpp"
#include <cstdarg>

namespace mvlib {
// Format: [LOG],uptime,lvl,message
void Logger::debug(const char *fmt, ...) {
  if ((uint8_t)LogLevel::DEBUG < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  unique_lock m(m_stdLogMutex);
  if (!m.isLocked()) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  if (m_config.logToTerminal.load()) 
    printf("[LOG],%d,DEBUG,%s\n", time, buffer);

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    logToSD("DEBUG", "[LOG],%d,DEBUG,%s", time, buffer);
  }
}

void Logger::info(const char *fmt, ...) {
  if ((uint8_t)LogLevel::INFO < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  unique_lock m(m_stdLogMutex);
  if (!m.isLocked()) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  if (m_config.logToTerminal.load()) 
    printf("[LOG],%d,INFO,%s\n", time, buffer);

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    logToSD("INFO", "[LOG],%d,INFO,%s", time, buffer);
  }
}

void Logger::warn(const char *fmt, ...) {
  if ((uint8_t)LogLevel::WARN < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  unique_lock m(m_stdLogMutex);
  if (!m.isLocked()) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  if (m_config.logToTerminal.load()) 
    printf("[LOG],%d,WARN,%s\n", time, buffer);

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    logToSD("WARN", "[LOG],%d,WARN,%s", time, buffer);
  }
}

void Logger::error(const char *fmt, ...) {
  if ((uint8_t)LogLevel::ERROR < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;

  unique_lock m(m_stdLogMutex);
  if (!m.isLocked()) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  if (m_config.logToTerminal.load()) 
    printf("[LOG],%d,ERROR,%s\n", time, buffer);

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    logToSD("ERROR", "[LOG],%d,ERROR,%s", time, buffer);
  }
} 

void Logger::fatal(const char *fmt, ...) {
  if ((uint8_t)LogLevel::FATAL < (uint8_t)m_minLogLevel
      || !(uint8_t)m_minLogLevel) return;
      
  unique_lock m(m_stdLogMutex);
  if (!m.isLocked()) return;

  char buffer[512];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  const uint32_t time = pros::millis();
  if (m_config.logToTerminal.load()) 
    printf("[LOG],%d,FATAL,%s\n", time, buffer);

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    logToSD("FATAL", "[LOG],%d,FATAL,%s", time, buffer);
  }
} 
} // namespace mvlib
