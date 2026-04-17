#include "mvlib/core.hpp"
#include "mvlib/telemetry.hpp"
#include <cstdarg>

namespace mvlib {

void Logger::logMessage(const LogLevel& level, const char *fmt, va_list args) {
  // Check global filter first
  if (!Telemetry::getInstance().shouldLog(level)) return;

  char buffer[1024];
  vsnprintf(buffer, sizeof(buffer), fmt, args);

  if (m_config.logToTerminal.load()) {
    Telemetry::getInstance().sendLog(level, "%s", buffer);
  }

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    logToSD(level, "%s", buffer);
  }
}

} // namespace mvlib
