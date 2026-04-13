#include "pros/rtos.hpp"
#include "mvlib/core.hpp"
#include <cstdarg>

namespace mvlib {
void Logger::logMessage(const LogLevel& level, const char *fmt, ...) {
  if (level < m_minLogLevel || (int)level <= 0 || !(int)m_minLogLevel) return;

  char buffer[1024];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buffer, sizeof(buffer), fmt, args);
  va_end(args);

  if (m_config.logToTerminal.load()) {
    unique_lock tLock(m_terminalMutex);
    if (tLock.isLocked()) {
      printf("%s\n", buffer);
    }
  }

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    logToSD(level, "%s", buffer);
  }
}
} // namespace mvlib
