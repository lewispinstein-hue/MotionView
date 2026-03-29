#include "mvlib/core.hpp"
#include "mvlib/private/forwardLogMacros.h"

namespace mvlib {
void Logger::setLogToTerminal(bool v) {
  m_config.logToTerminal.store(v);
  _MVLIB_FORWARD_DEBUG("logToTerminal set to: %d", v);
}

void Logger::setLogToSD(bool v) {
  if (m_started || m_sdLocked) {
    _MVLIB_FORWARD_WARN("setLogToSD() called after logger start — ignored. Set value: %d", v);
    return;
  }
  m_config.logToSD.store(v);
  _MVLIB_FORWARD_DEBUG("logToSD set to: %d", v);
}

void Logger::setPrintWatches(bool v) {
  m_config.printWatches.store(v);
  _MVLIB_FORWARD_DEBUG("printWatches set to: %d", v);
}

void Logger::setPrintTelemetry(bool v) {
  m_config.printTelemetry.store(v);
  _MVLIB_FORWARD_DEBUG("printTelemetry set to: %d", v);
}

void Logger::setPrintWaypoints(bool v) {
  m_config.printWaypoints.store(v);
  _MVLIB_FORWARD_DEBUG("printWaypoints set to: %d", v);
}

void Logger::setLogSystemInfo(bool v) {
  m_config.logSystemInfo.store(v);
  _MVLIB_FORWARD_DEBUG("logSystemInfo set to: %d", v);
}

void Logger::setLoggerMinLevel(LogLevel level) {
  _MVLIB_FORWARD_DEBUG("SetLoggerMinLevel set to: %d", (int)level);
  m_minLogLevel = level;
}

void Logger::setPoseGetter(std::function<std::optional<Pose>()> getter) {
  unique_lock m(m_mutex, TIMEOUT_MAX);
  if (!m.isLocked() || !getter) return;
  _MVLIB_FORWARD_DEBUG("Set poseGetter callback. Address: %p", (void*)&getter);
  m_getPose = std::move(getter);
}
} // namespace mvlib