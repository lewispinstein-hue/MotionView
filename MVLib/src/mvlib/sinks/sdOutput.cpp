#include "mvlib/core.hpp"
#include "mvlib/private/raii.hpp"
#include "mvlib/private/sdSink.hpp"
#include "mvlib/private/terminalOut.hpp"

#include <cstdarg>

namespace mvlib {

bool Logger::initSDLogger() {
  if (m_sdSink->locked())
    return false;

  const detail::SdInitResult result =
      m_sdSink->init(getBuildDate(), m_userBuildDate[0] != '\0');

  if (result.error == detail::SdInitError::cardMissing) {
    logMessage(LogLevel::WARN, detail::LogSource::SYSTEM,
               "initSDLogger() SD card was not detected after 10 checks; SD "
               "logging disabled.");

    return false;
  }

  if (result.cardInstalledInitially) {
    logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
               "initSDLogger() SD card detected on the first check.");

  } else if (result.cardDetectedAttempt >= 0) {
    logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
               "initSDLogger() SD card detected after %d delayed checks.",
               result.cardDetectedAttempt + 1);
  }

  if (result.usedFallbackBuildDate) {
    logMessage(
        LogLevel::WARN, detail::LogSource::SYSTEM,
        "initSDLogger() Build date not provided; using MVLib archive date.");
  }
  if (result.formattedTime[0] != '\0') {
    if (result.rtcPlausible) {
      logMessage(
          LogLevel::INFO, detail::LogSource::SYSTEM,
          "initSDLogger() VEX RTC is plausible; using it in the filename.");

    } else {
      logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
                 "initSDLogger() VEX RTC is inaccurate (%s); using the build "
                 "date and a "
                 "randomized suffix instead.",
                 result.formattedTime);
    }
  }

  switch (result.error) {
  case detail::SdInitError::none:
    if (m_config.printWaypoints.load()) {
      for (const auto &waypoint : m_waypoints) {
        if (waypoint.createdWithOutputEnabled)
          logWaypointCreatedToSD(waypoint);
      }
    }
    logMessage(
        LogLevel::INFO, detail::LogSource::SYSTEM,
        "initSDLogger() Successfully initialized SD card with filename: %s",
        m_sdSink->absoluteFilename());

    return true;
  case detail::SdInitError::locked:
    return false;
  case detail::SdInitError::filenameGeneration:
    logMessage(
        LogLevel::FATAL, detail::LogSource::SYSTEM,
        "initSDLogger() Filename generation failed. Aborting SD logging.");

    return false;
  case detail::SdInitError::filenameCollision:
    logMessage(LogLevel::FATAL, detail::LogSource::SYSTEM,
               "initSDLogger() Could not generate a unique SD filename. "
               "Aborting SD logging.");

    return false;
  case detail::SdInitError::initialWrite:
    logMessage(LogLevel::FATAL, detail::LogSource::SYSTEM,
               "initSDLogger() Initial SD write failed (errno %d). Aborting SD "
               "logging.",
               result.errorNumber);

    return false;
  case detail::SdInitError::fileOpen:
    logMessage(LogLevel::FATAL, detail::LogSource::SYSTEM,
               "initSDLogger() File %s could not be opened (errno %d). "
               "Aborting SD logging.",
               m_sdSink->absoluteFilename(), result.errorNumber);

    return false;
  case detail::SdInitError::cardMissing:
    return false;
  }

  return false;
}

bool Logger::setLoggingLocation(const char *location,
                                MissingFolderPolicy folderPolicy,
                                ExistingFilePolicy filePolicy) {
  detail::uniqueLock lock(m_mutex);
  if (!lock.isLocked() || m_started.load() || m_sdSink->locked())
    return false;

  const detail::SdLocationResult result =
      m_sdSink->setLocation(location, folderPolicy, filePolicy);

  if (!result.accepted) {
    switch (result.error) {
    case detail::SdLocationError::invalidLocation:
      logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
                 "setLoggingLocation() called with invalid location");

      break;
    case detail::SdLocationError::invalidLocationSyntax:
      logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
                 "setLoggingLocation() called with invalid location: %s",
                 location);

      break;
    case detail::SdLocationError::missingFilenameExtension:
      logMessage(
          LogLevel::INFO, detail::LogSource::SYSTEM,
          "setLoggingLocation() called with filename lacking extension: %s",
          location);

      break;
    case detail::SdLocationError::invalidFolderSegments:
      logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
                 "setLoggingLocation() called with invalid folder segments: %s",
                 location);

      break;
    case detail::SdLocationError::pathTooLong:
      logMessage(LogLevel::ERROR, detail::LogSource::SYSTEM,
                 "setLoggingLocation() path is too long: %s", location);

      break;
    case detail::SdLocationError::missingFolder:
      logMessage(
          LogLevel::ERROR, detail::LogSource::SYSTEM,
          "setLoggingLocation() could not find the path specified. Path: %s",
          location);

      break;
    case detail::SdLocationError::folderLookup:
      logMessage(LogLevel::ERROR, detail::LogSource::SYSTEM,
                 "setLoggingLocation() failed setting errno: %d",
                 result.errorNumber);

      break;
    case detail::SdLocationError::existingFile:
      logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
                 "setLoggingLocation() called with existing filename: %s",
                 result.resolvedFilePath);

      break;
    case detail::SdLocationError::none:
      break;
    }
    if (result.locked)
      m_config.logToSD.store(false);
    return false;
  }

  if (result.usedRootFallback) {
    logMessage(LogLevel::WARN, detail::LogSource::SYSTEM,
               "setLoggingLocation() could not find the path specified. "
               "Falling back to SD "
               "root. Path: %s",
               location);
  }
  if (result.overwroteExistingFile) {
    logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
               "setLoggingLocation() file already exists; overwriting: %s",
               m_sdSink->filename());
  }
  if (result.generatedNameForExistingFile) {
    logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
               "setLoggingLocation() file already exists; falling back to "
               "auto-generated "
               "filename in: %s",
               m_sdSink->folder());
  }

  logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
             "setLoggingLocation() successfully set logging folder to: %s",
             m_sdSink->folder());

  if (m_sdSink->filename()[0] != '\0') {
    logMessage(LogLevel::INFO, detail::LogSource::SYSTEM,
               "setLoggingLocation() successfully set logging file to: %s",
               m_sdSink->filename());
  }
  return true;
}

void Logger::logToSD(const LogLevel level, const char *format, ...) {
  if (!m_sdSink->ready())
    return;
  if (!detail::Telemetry::getInstance().shouldLog(level))
    return;

  va_list args;
  va_start(args, format);
  const detail::SdWriteResult result = m_sdSink->writeV(level, format, args);
  va_end(args);

  if (result.error != detail::SdWriteError::write &&
      result.error != detail::SdWriteError::flush) {
    return;
  }

  if (!m_sdSink->lock())
    return;
  m_config.logToSD.store(false);

  if (m_config.logToTerminal.load()) {
    const char *operation =
        result.error == detail::SdWriteError::write ? "write" : "flush";
    logMessage(LogLevel::ERROR, detail::LogSource::SYSTEM,
               "SD logging disabled after %s failure (errno %d).", operation,
               result.errorNumber);
  }
}

} // namespace mvlib
