/**
 * @file forwardLogMacros.h
 * @brief Forward log macros to the logger. These macros 
 *        should not be used by the user. Instead use 
 *        LOG_INFO/WARN/etc macros,
 *        mvlib::Logger::getInstance().info/warn/etc, or
 *        mvlib::Logger::getInstance().logMessage().
*/

#ifndef _MVLIB_FORWARD_LOG_MACROS
#define _MVLIB_FORWARD_LOG_MACROS
#define _MVLIB_FORWARD_DEBUG(fmt, ...)                                                 \
  do { if (m_config.logSystemInfo.load())                                              \
    Logger::getInstance().debug("[MVLIB] " fmt, ##__VA_ARGS__);                        \
  } while (false)

#define _MVLIB_FORWARD_INFO(fmt, ...)                                                 \
  do { if (m_config.logSystemInfo.load())                                             \
    Logger::getInstance().info("[MVLIB] " fmt, ##__VA_ARGS__);                        \
  } while (false)

#define _MVLIB_FORWARD_WARN(fmt, ...)                                                 \
  do { if (m_config.logSystemInfo.load())                                             \
    Logger::getInstance().warn("[MVLIB] " fmt, ##__VA_ARGS__);                        \
  } while (false)

#define _MVLIB_FORWARD_ERROR(fmt, ...)                                                 \
  do { if (m_config.logSystemInfo.load())                                              \
    Logger::getInstance().error("[MVLIB] " fmt, ##__VA_ARGS__);                        \
  } while (false)

#define _MVLIB_FORWARD_FATAL(fmt, ...)                                                 \
  do { if (m_config.logSystemInfo.load())                                              \
    Logger::getInstance().fatal("[MVLIB] " fmt, ##__VA_ARGS__);                        \
  } while (false)
#endif
