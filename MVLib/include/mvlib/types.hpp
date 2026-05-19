#pragma once

#include <cstdint>
#include <atomic>

namespace mvlib {
/**
 * @enum LogLevel
 * @brief Log severity levels used for filtering and formatting.
 *
 * @note Ordering matters: higher values are considered "more severe".
 */
enum class LogLevel : uint8_t {
  NONE = 0,   /// The lowest log level. Used for simply disabling logger.
  OFF = NONE, /// Alias for NONE
  DEBUG,      /// Used for info related to startup and diagnostics
  INFO,       /// The most frequently used log level. 
  WARN,       /// Used for logs still not dangerous, but that should stand out
  ERROR,      /// Used when something has gone wrong.
  FATAL,      /// Used only for serious failures; often precedes a force stop.
  OVERRIDE = 0xFF /// Used to override the min logging level.
};

/**
 * @struct Pose struct used internally that represents the robot's x, y, and theta values.
 *         Used for sending pose data to MotionView.
*/
struct Pose {
  double x{};
  double y{};
  double theta{};
};

// Logger structs
/** 
 * @struct LoggerTimings
 * @brief Runtime configuration for Logger output and update loops.
 *
 * @note All timings are in ms.
 */
struct LoggerTimings {
  /**
   * @brief SD file flush interval. At 1s (default), 
   *        SD card flushes out of RAM every 1 second.
   *
   * @note This interval is used to flush the file buffer. 
   *       It uses the standard fflush(file) function for flushing.
   *
   */
  uint32_t sdBufferFlushInterval = 1000;
  
  /**
   * @brief Terminal output flush interval. At 1s (default), 
   *        terminal output flushes out of its buffer
   *        every 1 second. 
   *
   * @note This interval is used to flush the stdout buffer. 
   *       It uses the standard fflush(stdout) function for flushing.
   *
   * @warning Use this to tune flushes to your specific robot
   *          configuration. Lower values force the buffer to 
   *          be flushed more frequently, while higher values
   *          force flush the buffer less frequently.
   */
  uint32_t stdoutBufferFlushInterval = 400;

  /**
   * @brief Controls how often mvlib polls for new data and logs it. Default: 100ms
   *
   * @note This interval overrides the sd card interval. If logging to 
   *       terminal and to sd card, the terminal polling rate is used.
   *
   * @warning If the polling rate is too fast, it may overwhelm the 
   *          brain -> controller connection, which may cause the
   *          connection to be completely dropped and cease logging 
   *          or transmission lag.
   */
  uint32_t terminalPollingRate = 100;

  /**
   * @brief Controls how often mvlib polls for new data and logs it. Default: 80ms
   *
   * @note Sd card output is buffered by SD_FLUSH_INTERVAL_MS. This only 
   *       controls how often that buffer is written too. Faster polling
   *       rates may lead to resource starvation of other tasks.
   */
  uint32_t sdPollingRate = 80;

  /**
   * @brief Minimum interval between watch and waypoint roster sync beacons.
   *
   * @note Lower values improve late-join recovery at the cost of bandwidth.
   */
  uint32_t rosterSyncAllInterval = 8000;
};

/**
 * @struct loggerConfig
 * @brief Runtime configuration for Logger output and periodic reporters.
 *
 * @note Most fields are atomic so they can be toggled while running. 
 */
struct LoggerConfig {
  /// @brief Print logs to the terminal.
  std::atomic<bool> logToTerminal{true};

  /// @brief Write logs to SD (locked after logger start).
  std::atomic<bool> logToSD{true};

  /// @brief Print registered watches.
  std::atomic<bool> printWatches{true};
  
  /// @brief Print periodic telemetry.
  std::atomic<bool> printTelemetry{true};

  /// @brief Print waypoints upon timeout or reached.
  std::atomic<bool> printWaypoints{true};

  /// @brief Print system messages (e.g., warnings, errors)
  std::atomic<bool> logSystemInfo{true};
};
} // namespace mvlib
