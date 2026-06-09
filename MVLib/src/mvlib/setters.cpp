#include "mvlib/core.hpp"
#include "mvlib/private/telemetry.hpp"
#include "mvlib/types.hpp"
#define _MVLIB_PREVENT_MACRO_CLEANUP
#include "mvlib/private/forwardLogMacros.h"
#include "mvlib/private/raii.hpp"

namespace mvlib {

void Logger::setLogToTerminal(bool v) {
  m_config.logToTerminal.store(v);
  _MVLIB_FORWARD_DEBUG("logToTerminal() set to: %d", v);
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

void Logger::setTimings(LoggerTimings timings) {
  _MVLIB_FORWARD_DEBUG("SetTimings changed");
  m_timings = timings;
}

void Logger::setMinLogLevel(LogLevel level) {
  if (level == LogLevel::OVERRIDE) return;

  // Telemetry engine is now the source of truth for the min log level
  detail::Telemetry::getInstance().setMinLevel(level);
  _MVLIB_FORWARD_DEBUG("SetMinLogLevel set to: %d", (int)level);
}

void Logger::setPoseGetter(std::function<std::optional<Pose>()> getter) {
  detail::uniqueLock m(m_mutex);
  if (!m.isLocked() || !getter) {
    _MVLIB_FORWARD_DEBUG("Unable to set pose getter because mutex failed "
                         "to lock. Try adding delay or calling at a different "
                         "time.");
    return;
  }
  _MVLIB_FORWARD_DEBUG("SetPoseGetter set callback.");
  m_getPose = std::make_shared<std::function<std::optional<Pose>()>>(std::move(getter));
  m_poseGetterMutex = std::make_shared<pros::Mutex>();
}
} // namespace mvlib
