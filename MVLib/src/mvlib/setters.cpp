#include "mvlib/core.hpp"
#include "mvlib/private/getOdomProvider.hpp"
#include "mvlib/private/raii.hpp"
#include "mvlib/private/sdSink.hpp"
#include "mvlib/private/terminalOut.hpp"
#include "mvlib/types.hpp"

#include <cstdio>

namespace mvlib {

void Logger::setLogToTerminal(bool v) {
  m_config.logToTerminal.store(v);
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
             "logToTerminal() set to: %d", v);
}

void Logger::setLogToSD(bool v) {
  detail::uniqueLock lock(m_mutex, TIMEOUT_MAX);
  if (!lock.isLocked())
    return;

  if (m_started.load() || m_sdSink->locked()) {
    logMessage(
        LogLevel::WARN, detail::LogSource::SYSTEM,
        "setLogToSD() called after logger start — ignored. Set value: %d", v);

    return;
  }
  m_config.logToSD.store(v);
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM, "logToSD set to: %d",
             v);
}

void Logger::setPrintWatches(bool v) {
  m_config.printWatches.store(v);
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
             "printWatches set to: %d", v);
}

void Logger::setPrintTelemetry(bool v) {
  m_config.printTelemetry.store(v);
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
             "printTelemetry set to: %d", v);
}

void Logger::setPrintWaypoints(bool v) {
  m_config.printWaypoints.store(v);
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
             "printWaypoints set to: %d", v);
}

void Logger::setLogSystemInfo(bool v) {
  m_config.logSystemInfo.store(v);
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
             "logSystemInfo set to: %d", v);
}

void Logger::setTimings(LoggerTimings timings) {
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM, "SetTimings changed");

  m_sdBufferFlushInterval.store(timings.sdBufferFlushInterval);
  m_stdoutBufferFlushInterval.store(timings.stdoutBufferFlushInterval);
  m_sdPollingRate.store(timings.sdPollingRate);
  m_terminalPollingRate.store(timings.terminalPollingRate);
  m_rosterSyncAllInterval.store(timings.rosterSyncAllInterval);
  m_sdSink->setFlushInterval(timings.sdBufferFlushInterval);
}

void Logger::setMinLogLevel(LogLevel level) {
  if (level == LogLevel::OVERRIDE)
    return;

  // Telemetry engine is now the source of truth for the min log level
  detail::Telemetry::getInstance().setMinLevel(level);
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
             "SetMinLogLevel set to: %d", static_cast<int>(level));
}

void Logger::setBuildDate(const char *buildDate) {
  detail::uniqueLock lock(m_mutex, TIMEOUT_MAX);
  if (!lock.isLocked())
    return;

  if (m_started.load() || m_sdSink->locked()) {
    logMessage(LogLevel::WARN, detail::LogSource::SYSTEM,
               "setBuildDate() called after logger start — ignored.");

    return;
  }

  if (!buildDate || buildDate[0] == '\0') {
    m_userBuildDate[0] = '\0';
    logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
               "setBuildDate() cleared user build date.");

    return;
  }

  snprintf(m_userBuildDate, sizeof(m_userBuildDate), "%s", buildDate);
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
             "setBuildDate() set user build date to: %s", m_userBuildDate);
}

const char *Logger::getBuildDate() const {
  return m_userBuildDate[0] != '\0' ? m_userBuildDate : __DATE__;
}

void Logger::setPoseGetter(std::function<std::optional<Pose>()> getter,
                           detail::OdomProvider provider) {
  detail::uniqueLock m(m_mutex);
  if (!m.isLocked() || !getter) {
    logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
               "Unable to set pose getter because mutex failed to lock. Try "
               "adding delay or "
               "calling at a different time.");

    return;
  }
  m_getPose =
      std::make_shared<std::function<std::optional<Pose>()>>(std::move(getter));
  m_poseGetterMutex = std::make_shared<pros::Mutex>();
  m_odomProvider = provider;
  logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
             "SetPoseGetter set callback.");
}
} // namespace mvlib
