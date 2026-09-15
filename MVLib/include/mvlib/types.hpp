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
   * @brief Terminal output flush interval. At 400ms (default),
   *        terminal output flushes out of its buffer
   *        every 400ms.
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
   * @brief Controls periodic pose telemetry while terminal output is enabled.
   *        Default: 100ms.
   *
   * @note If terminal and SD logging are both enabled, this interval also
   *       controls the pose records written to SD. Watches and waypoints run
   *       on MVLib's fixed internal update cadence.
   *
   * @warning If the polling rate is too fast, it may overwhelm the
   *          brain -> controller connection, which may cause the
   *          connection to be completely dropped and cease logging
   *          or transmission lag.
   */
  uint32_t terminalPollingRate = 100;

  /**
   * @brief Controls periodic pose telemetry while terminal output is disabled.
   *        Default: 80ms.
   *
   * @note This does not control SD flushes, watches, waypoint events, or
   *       direct log calls. SD flushing is controlled by
   *       sdBufferFlushInterval.
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
 * @struct LoggerConfig
 * @brief Runtime configuration for Logger output and periodic reporters.
 *
 * @note Most fields are atomic so they can be toggled while running.
 */
struct LoggerConfig {
  /// @brief Print logs to the terminal.
  std::atomic<bool> logToTerminal{true};

  /// @brief Write logs to SD (disabled after an SD setup or I/O failure).
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

// SD card

/**
  * @enum MissingFolderPolicy
  * @brief Policy used when the requested SD logging folder does not exist.
  */
enum class MissingFolderPolicy : uint8_t {
  /// @brief Disable SD logging immediately and return failure.
  disable = 0,

  /// @brief Fall back to the SD root directory (`/usd/`) and continue file resolution there.
  useRoot
};

/**
  * @enum ExistingFilePolicy
  * @brief Policy used when an explicit SD logging file already exists.
  *
  * @note This policy is only consulted after folder resolution has completed.
  */
enum class ExistingFilePolicy : uint8_t {
  /// @brief Disable SD logging immediately and return failure.
  disable = 0,

  /// @brief Reuse the explicit path and overwrite the existing file.
  overwrite,

  /// @brief Preserve the existing file and instead generate a new timestamped
  ///        filename in the resolved folder.
  automatic
};
} // namespace mvlib
