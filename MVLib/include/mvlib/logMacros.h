#pragma once

/**
 * @file logMacros.hpp 
 * @brief Macro wrappers for mvlib::Logger::logMessage().
 *        Not needed, just for user convience.
*/

namespace mvlib {
/**
 * @defgroup mvlib Logging Macros
 * @brief Convenience wrappers around mvlib::Logger::logMessage().
 *
 * Where to use them:
 * - Most call-sites that just want to log something quickly.
 *
 * When to use them:
 * - Prefer LOG_INFO/WARN/ERROR over calling logMessage() directly unless you
 *   need a custom source pointer or you are writing logger internals.
 *
 * @note These macros forward directly to mvlib::Logger::logMessage().
 *
 * @note These will not show up inside of MotionView GUI. To have logs show up
 *       in GUI, use logger.debug/info/warn/error().
 * @{
 */
#if !defined(LOG_DEBUG) && \
    !defined(LOG_INFO)  && \
    !defined(LOG_WARN)  && \
    !defined(LOG_ERROR) && \
    !defined(LOG_FATAL)

/// @brief Log a DEBUG-level message (usually noisy, for development).
#define LOG_DEBUG(fmt, ...)                                                    \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::DEBUG, fmt, ##__VA_ARGS__)

/// @brief Log an INFO-level message (normal operational breadcrumbs).
#define LOG_INFO(fmt, ...)                                                     \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::INFO, fmt, ##__VA_ARGS__)

/// @brief Log a WARN-level message (unexpected but recoverable situations).
#define LOG_WARN(fmt, ...)                                                     \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::WARN, fmt, ##__VA_ARGS__)

/// @brief Log an ERROR-level message (failure that likely affects behavior).
#define LOG_ERROR(fmt, ...)                                                    \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::ERROR, fmt, ##__VA_ARGS__)

/// @brief Log a FATAL-level message (serious failure; usually precedes a stop).
#define LOG_FATAL(fmt, ...)                                                    \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::FATAL, fmt, ##__VA_ARGS__)

#else // OkApi sometimes has LOG macros, so prevent redefinition
#define MVLIB_LOGS_REDEFINED
#warning "Something else is using LOG_ macros. MVLib's log macros have moved to MVLIB_LOG_."

#define MVLIB_LOG_DEBUG(fmt, ...)                                              \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::DEBUG, fmt, ##__VA_ARGS__)

#define MVLIB_LOG_INFO(fmt, ...)                                               \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::INFO, fmt, ##__VA_ARGS__)

#define MVLIB_LOG_WARN(fmt, ...)                                               \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::WARN, fmt, ##__VA_ARGS__)

#define MVLIB_LOG_ERROR(fmt, ...)                                              \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::ERROR, fmt, ##__VA_ARGS__)

#define MVLIB_LOG_FATAL(fmt, ...)                                              \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::FATAL, fmt, ##__VA_ARGS__)
#endif
/** @} */
} // namespace mvlib