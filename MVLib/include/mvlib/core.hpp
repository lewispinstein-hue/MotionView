#pragma once
/**
 * @file core.hpp
 * @brief Core MVLib header. Provides the Logger singleton.
 *
 * This header provides: A singleton logger (mvlib::Logger) that can
 *   print to the PROS terminal and/or
 *   write to an SD card file.
 *
 * Where to use it:
 * - Robot bring-up, debugging, telemetry, and quick diagnosis on-field.
 * - Periodic status reporting (battery, task list) during development and test.
 *
 * \b Example
 * @code
 * #include "main.h"
 * #include "mvlib/api.hpp"
 * #include "mvlib/Optional/customOdom.hpp"
 * void initialize() {
 *   auto& logger = mvlib::Logger::getInstance();
 *   mvlib::setOdom([]() -> std::optional<mvlib::Pose> {
 *     return mvlib::Pose{0.0, 0.0, 0.0};
 *   });
 *   logger.setRobot({
 *     .leftDrivetrain = &leftMg,
 *     .rightDrivetrain = &rightMg
 *   });
 *   logger.start();
 * }
 * @endcode
 */

#include "pros/motor_group.hpp"
#include "pros/rtos.hpp"
#include "renderHelper.hpp"
#include "waypoint.hpp"
#include "types.hpp"
#include "watches.hpp"
#include "private/misc.hpp"
#include "private/dateGetter.hpp"
#include "private/raii.hpp"

#include <atomic>
#include <cstddef>
#include <memory>
#include <optional>
#include <utility>
#include <vector>
#include <string>

#define MVLIB_VERSION 300000 // 3.0.0

namespace mvlib {
/**
 * @class Logger
 * @brief Singleton logging + telemetry manager.
 *
 * @note All methods are thread-safe and can be used from any thread.
 *
 * @warning After creating the logger instance (Logger::getInstance()), the
 *          standard PROS terminal multiplexers (sout/serr) and native COBS 
 *          encoding are deactivated to optimize VEXnet bandwidth. Do not 
 *          use standard print functions (e.g., printf, std::cout) after 
 *          instantiating the logger. Raw text will collide with the high-speed 
 *          binary telemetry stream, resulting in corrupted packets and undefined 
 *          behavior during decoding. Use Logger::info(), warn(), etc. for
 *          safe logging. Standard print functions may work in some cases, but
 *          it is not guaranteed.
 */
class Logger {
public:
  /**
   * @struct Drivetrain
   * @brief References to robot components used by telemetry helpers.
   */
  struct Drivetrain {
    /// @brief Left drivetrain motors for velocity.
    pros::MotorGroup* leftDrivetrain;

    /// @brief Right drivetrain motors for velocity. 
    pros::MotorGroup* rightDrivetrain;
  }; 

  /**
   * @brief Access the singleton logger instance.
   * \return Reference to the global Logger instance.
   */
  [[nodiscard]] static Logger& getInstance();

  // ------------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------------

  /**
   * @brief Start the logger background task (periodic telemetry + watches).
   *
   * When to use it:
   * - Call once after configuration and (optionally) setRobot().
   *
   * @note SD logging may become locked after start() if a failure is detected.
   */
  void start();

  /// @brief Pause periodic printing without destroying the logger task.
  void pause();

  /// @brief Resume after pause().
  void resume();

  /**
   * @brief Get a compact status bitmask / state code.
   * \return Implementation-defined status value.
   *
   * @note The bitmap returned is from FreeRTOS Task Status Enum (pros::task_state_e_t).
   */
  [[nodiscard]] uint32_t status() const;

  // ------------------------------------------------------------------------
  // Config setters/getters
  // ------------------------------------------------------------------------

  /**
   * @brief Enable/disable terminal logging.
   *
   * @note This can typically be changed at runtime.
   */
  void setLogToTerminal(bool v);

  /**
   * @brief Enable/disable SD logging.
   *
   * @note Only changeable before start(). Calls after start() are ignored.
   */
  void setLogToSD(bool v);

  /**
   * @brief Enable/disable Pose/Telemetry printing.
   *
   * @note If false, MotionView will only update with watches.
   */
  void setPrintTelemetry(bool v);

  /**
   * @brief Enable/disable printing of registered watches.
   */
  void setPrintWatches(bool v);
  
  /**
   * @brief Enable/disable printing of waypoints.
   */
  void setPrintWaypoints(bool v);

  /**
   * @brief Enable/disable printing of system messages. Recommended to 
   *        be left on for debugging. Disable if you want your MotionView
   *        GUI to be void of system messages.
   */
  void setLogSystemInfo(bool v);

  /**
   * @brief Set the runtime configuration for Logger output and update loops.
   */
  void setTimings(LoggerTimings timings);

  /**
   * @brief Set the minimum log level that will be emitted. Useful for
   *        Whenever you want to filter out logs that are not important to you.
   */
  void setMinLogLevel(LogLevel level);

  // ------------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------------

  /**
   * @brief Provide a custom pose getter (for any odometry library).
   * @param getter Callable that returns a Pose or std::nullopt if unavailable.
   *
   * @note Prefer the adapter that matches your odometry library from
   *       include/mvlib/Optional when one is available.
   *
   * \b Example
   * @code
   * // LemLib example
   * #include "mvlib/api.hpp"
   * #include "lemlib/api.hpp"
   * lemlib::Chassis chassis (...);
   * void initialize() {
   *   logger.setPoseGetter([&]() -> std::optional<mvlib::Pose> {
   *     lemlib::Pose pose = chassis.getPose(); 
   *     if (!std::isfinite(pose.x) || !std::isfinite(pose.y)) return std::nullopt;
   *     return mvlib::Pose{pose.x, pose.y, pose.theta};
   *   });
   * }
   * @endcode
   */
  void setPoseGetter(std::function<std::optional<Pose>()> getter);

  /**
   * @brief Provide robot component references used by telemetry helpers.
   * @param drivetrain drivetrain refs.
   * @param useSpeedEstimation If true, uses speed estimation from odometry if
   *                           available instead of actual motor-reported velocity.
   *
   * \return True if refs were accepted (e.g., non-null and consistent), false
   *         otherwise.
   *
   * @note If you do not call this, drivetrain speed will be approximated from 
   *       pose. This is not recommended.
   */
  bool setRobot(Drivetrain drivetrain, bool useSpeedEstimation = false);

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

  /**
   * @brief Sets the SD logging destination as either a folder or a specific file path.
   *
   * @param location      Absolute SD-relative folder or file path
   *                      (e.g. "/logs" or "/logs/match.log").
   * @param folderPolicy  Behavior when the requested folder does not exist.
   * @param filePolicy    Behavior when the requested explicit file already exists.
   *
   * @note Pass a POSIX-style SD path relative to /usd, starting with /
   *       (for example /logs or /logs/match.log, not /usd/logs).
   * @note The target folder must already exist on the SD card. This function will
   *       not create missing folders. If folderPolicy is useRoot, MVLib falls back
   *       to the SD root directory instead.
   * @note If location is a folder, MVLib will automatically generate a timestamped filename
   *       inside it.
   * @note If location is a file path, the file portion must include an extension
   *       (for example .log). Folder segments must not contain '.'.
   * @note File policy is only consulted after folder resolution has finished, and only
   *       when an explicit filename remains selected and already exists.
   * @note If filePolicy is automatic, MVLib clears the explicit filename and later
   *       generates a timestamped filename in the resolved folder during initialization.
   *
   * \return true if the folder exists and the destination was accepted, false otherwise.
   *
   * \b Examples
   * @code
   * // Route logs to "/telemetry" with an auto-generated timestamped filename.
   * if (!logger.setLoggingLocation("/telemetry",
   *                                MissingFolderPolicy::disable,
   *                                ExistingFilePolicy::automatic)) {
   *   logger.warn("SD logging disabled: /telemetry folder not found.");
   * }
   *
   * // Route logs to a specific file.
   * logger.setLoggingLocation("/telemetry/match.log",
   *                           MissingFolderPolicy::useRoot,
   *                           ExistingFilePolicy::overwrite);
   * @endcode
   */
  bool setLoggingLocation(const char *location,
                          MissingFolderPolicy folderPolicy = MissingFolderPolicy::disable,
                          ExistingFilePolicy filePolicy = ExistingFilePolicy::automatic);

  // ------------------------------------------------------------------------
  // Logging
  // ------------------------------------------------------------------------

  /**
   * @brief Emit a computer-formatted log message to MotionView. Unlike the LOG_
   *        macros, these functions produce logs MotionView can parse and
   *        display. These functions only differ in the severity level that they 
   *        log at. 
   *
   * @param fmt printf-style format string.
   * @param ... Format arguments.
   *
   * @note Messages are truncated to 512 bytes.
   * @note These are affected by minLoggerLevel.
   *
   * \b Example
   * @code
   * logger.debug("Hello, %s", "world");
   * logger.info("Battery Temp: %.1f", pros::battery::get_temperature());
   * @endcode
   */
  _MVLIB_FORMAT_CHECK(2, 3)
  void debug(const char *fmt, ...);

  /** 
   * @copydoc debug
   * @brief Emit info level log message.
   */
  _MVLIB_FORMAT_CHECK(2, 3)
  void info(const char *fmt, ...);

  /** 
   * @copydoc debug
   * @brief Emit warning level log message.
   */
  _MVLIB_FORMAT_CHECK(2, 3)
  void warn(const char *fmt, ...);

  /** 
   * @copydoc debug
   * @brief Emit error level log message.
   */
  _MVLIB_FORMAT_CHECK(2, 3)
  void error(const char *fmt, ...);

  /** 
   * @copydoc debug 
   * @brief Emit fatal level log message.
   */
  _MVLIB_FORMAT_CHECK(2, 3)
  void fatal(const char *fmt, ...);

  // ------------------------------------------------------------------------
  // Waypoints
  // ------------------------------------------------------------------------
  
  /**
   * @brief Add a waypoint to the logger.
   * @param name Name of the waypoint.
   * @param details Waypoint target and tolerance settings.
   * @return A handle to the waypoint.
   *
   * @note To access value of the waypoint, use the handle returned by this 
   *       function.
   *
   * @note For performance reasons, names are truncated to 24 characters long.
   *
   * \b Example
   * @code
   * auto waypoint = logger.addWaypoint("Blue left matchloader", {
   *   .tarX = 70,
   *   .tarY = -47,
   *   .tarT = 0,
   *   .linearTol = 2,
   *   .thetaTol = 10,
   *   .timeoutMs = 5_mvS,
   * });
   * auto off = waypoint.getOffset();
   * logger.info("Waypoint offset: %.1f, %.1f, %.1f",
   *             off.offX, off.offY, off.offT.value_or(0.0));
   * @endcode
   * This example creates a waypoint named "Blue left matchloader" with a 
   * target position of (70, -47), XY tolerance of 2, theta tolerance of 
   * 10 degrees, and a timeout of 5 seconds.
   */
  template <size_t len>
  WaypointHandle addWaypoint(const char (&name)[len], WaypointParams details) {
    static_assert(len <= 25,
                "\n\n\n------------------------------------------------------------------------"
                "\naddWaypoint() assigned with name too long. Max is 24 characters.\n"
                "------------------------------------------------------------------------\n\n\n");
    return internalRegisterWaypoint(std::move(name), std::move(details));
  }

  /**
   * @brief Re-send roster entries for all active waypoints. Use this to fix issues 
   *        of waypoints not appearing in MotionView.
   *
   * @note Inactive waypoints are intentionally omitted so they stay dropped
   *       from the viewer roster.
   */
  void resyncAllWaypointsRoster();
  
  // ------------------------------------------------------------------------
  // Watches
  // ------------------------------------------------------------------------

  /**
   * @struct DefaultWatches
   * @brief Built-in watchdog watches that stay silent while normal and periodically log when tripped.
   *
   * @note These are affected by minLoggerLevel.
   *
   * @note Drivetrain watches will fail if setRobot has not been set, or if the
   *       drivetrain pointers are invalid.
   */
  struct DefaultWatches {
    /// @brief Watch left drivetrain temperature. Warns above 50 C.
    bool leftDrivetrainWatchdog = true;

    /// @brief Watch right drivetrain temperature. Warns above 50 C.
    bool rightDrivetrainWatchdog = true;

    /// @brief Watch battery temperature and voltage. Warns above 45 C or outside 12000-13250 mV.
    bool batteryWatchdog = true;
  };

  /**
   * @brief Register the built-in default watchdog watches.
   *
   * @param watches Built-in watchdog watches
   *
   * @note These are affected by minLoggerLevel.
   * @note Drivetrain watches will fail if setRobot has not been set, or if the
   *       drivetrain pointers are invalid.
   *
   * \return True if all wanted watches were successfully registered.
   */
  bool setDefaultWatches(const DefaultWatches watches);

  /**
   * @brief Re-send roster entries for all watches. Use this to fix issues 
   *        of watches not appearing in MotionView.
   *
   * @note Watches with an elevated/predicate label will send both the default
   *       and elevated roster labels.
   */
  void resyncAllWatchesRoster();

  /**
   * @brief Register a watch on a getter function.
   *
   * @tparam Getter Callable that returns the value to render (numeric/bool/string/cstr).
   * @param label Display label for the watch.
   * @param baseLevel Level used for normal samples.
   * @param type Watch behavior. WatchMode::onInterval emits on a regular interval.
   *             WatchMode::onChange emits only after the rendered value changes and
   *             the debounce interval has elapsed.
   * @param intervalMs Sampling/print interval in ms for interval watches, or debounce
   *                   interval in ms for on-change watches.
   * @param getter Callable returning a value.
   * @param fmt Optional printf-style format for floating-point values (e.g. "%.2f").
   * @param ov Optional LevelOverride (type inferred from getter).
   *
   * @note For performance reasons, names are truncated to 24 characters long.
   * @note Adding a watch is computationally expensive. Don't call logger.watch()
   *       repeatedly. Additionally, if the same .watch() is called
   *       multiple times, each watch will be separate and logged independently.
   *
   * \return WatchHandle for the registered watch.
   *
   * \b Example
   * @code
   * logger.watch("Intake RPM", LogLevel::INFO, WatchMode::onInterval, 1_mvS,
   *   [&]() { return left_mg.get_actual_velocity(); }, "%.0f",
   *   mvlib::LevelOverride<double>{
   *     .elevatedLevel = LogLevel::WARN,
   *     .predicate = mvlib::asPredicate<double>([](const double& v) { return v > 550; }),
   *     .label = "Intake RPM over 550"
   *   });
   *
   * logger.watch("Auton Stage", LogLevel::INFO, WatchMode::onChange, 250_mvMs,
   *   [&]() { return static_cast<int>(autonStage); });
   * @endcode
   */
  template <class Getter, size_t len>
  WatchHandle watch(const char (&label)[len], LogLevel baseLevel, WatchMode type, 
                    uint32_t intervalMs, Getter&& getter, std::string fmt = {},
                    LevelOverride<std::decay_t<std::invoke_result_t<
                      Getter&>>> ov = {}) {
    using T = std::decay_t<std::invoke_result_t<Getter &>>;
    static_assert(len <= 25,
        "\n\n\n------------------------------------------------------------------------"
        "\nwatch() assigned with name too long. Max is 24 characters.\n"
        "------------------------------------------------------------------------\n\n\n");

    return WatchHandle(addWatch<T>(label, baseLevel, intervalMs,
                       std::forward<Getter>(getter),
                       std::move(ov),
                       std::move(fmt),
                       (type == WatchMode::onChange)));
  }

private:
  Logger();
  Logger(const Logger&) = delete;
  Logger& operator=(const Logger&) = delete;

  /// @brief Background update loop invoked by the logger task.
  void Update();

  /// @brief Validate that required robot references are present.
  bool checkRobotConfig();

  /// @brief Validate that the logger configuration is valid.
  bool configValid() const;

  /// @brief Initialize SD logger file handle and state.
  bool initSDLogger();

  /// @brief Return the current sessions filename.
  void getTimestampedFilename(char *buffer, size_t len);

  /**
   * @brief Convert a LogLevel to a printable string.
   * @param level Log level to convert.
   * \return C-string representation of the level.
   */
  const char* levelToString(const LogLevel& level) const;

  /**
   * @struct Watch
   * @brief Internal watch record.
   */
  struct InternalWatch {
    /// @brief Watch identifier.
    WatchId id{};

    /// @brief Watch display label.
    std::string label{};

    /// @brief Alternate label used when the watch predicate is tripped.
    std::string elevatedLabel{};

    /// @brief Base log level for normal samples.
    LogLevel baseLevel = LogLevel::INFO;

    /// @brief Print interval in ms, or debounce interval in ms when onChange is true.
    uint32_t intervalMs{1000};

    /// @brief Last emit timestamp (ms).
    uint32_t lastPrintMs{0};

    /// @brief Optional numeric format string.
    std::string fmt{};

    /// @brief If true, only emit after a rendered value change.
    bool onChange = false;

    /// @brief Last emitted rendered value (for onChange).
    std::optional<std::string> lastValue = std::nullopt;

    /// @brief Computes (level, rendered eval string, label, predicate) for the current sample.
    std::shared_ptr<std::function<std::tuple<LogLevel, std::string, std::string, bool>()>> eval;

    /// @brief Serializes execution of the watch evaluator without holding m_mutex.
    std::shared_ptr<pros::Mutex> evalMutex;

    /// @brief If true, watch will be evaluated and printed if necessary.
    bool active = true;
  };

  /// @brief Next watch id to assign.
  WatchId m_nextId = 1;

  /// @brief Watch registry keyed by WatchId.
  std::vector<InternalWatch> m_watches;

  /// @brief Evaluate a single watch and optionally emit it immediately.
  std::string evaluateWatch(WatchId id, bool emit);

  /// @brief Re-send the roster entry for a single watch.
  bool resyncWatchRoster(WatchId id);

  /// @brief Find a watch without taking m_mutex.
  InternalWatch* m_findWatchUnlocked(WatchId id);

  /// @brief Find a const watch without taking m_mutex.
  const InternalWatch* m_findWatchUnlocked(WatchId id) const;

  /**
   * @brief Internal watch registration routine.
   *
   * @tparam T Watch value type.
   * @tparam Getter Getter callable type.
   * @param label Display label.
   * @param baseLevel Base log level.
   * @param intervalMs Interval in ms, or debounce interval when onChange=true.
   * @param getter Getter callable.
   * @param ov Optional override predicate/level.
   * @param fmt Optional numeric format.
   * @param onChange If true, print only on change after the debounce interval.
   * \return Assigned WatchId.
   *
   * @note If the watch failed to add, it will return (WatchId)-1.
   */
  template <class T, class Getter>
  WatchId addWatch(std::string label, const LogLevel baseLevel, 
                   const uint32_t intervalMs, Getter&& getter, 
                   LevelOverride<T> ov, std::string fmt,
                   bool onChange = false) {
    detail::uniqueLock lock(m_mutex);
    if (!lock.isLocked()) return static_cast<WatchId>(-1);

    using EvalType = T;

    InternalWatch w;
    w.id = m_nextId++;
    w.label = std::move(label);
    w.elevatedLabel = ov.label;
    w.baseLevel = baseLevel;
    w.intervalMs = intervalMs;
    w.onChange = onChange;
    w.fmt = std::move(fmt);

    std::decay_t<Getter> eval = std::forward<Getter>(getter); // store callable by value

    // Capture fmt by value (not by reference to w), and move ov in.
    const std::string fmtCopy = w.fmt;
    const std::string labelCopy = w.label;

    // When w.eval is called, it returns final log level, getter eval, final label
    w.eval = std::make_shared<std::function<std::tuple<LogLevel, std::string, std::string, bool>()>>(
              [baseLevel, labelCopy, fmtCopy, eval = std::move(eval),
              ov = std::move(ov)]() mutable ->
              std::tuple<LogLevel, std::string, std::string, bool> {

      EvalType evalValue = static_cast<EvalType>(eval());

      const bool tripped = (ov.predicate && ov.predicate(evalValue));

      // Log level based on predicate
      const LogLevel lvl = tripped ? ov.elevatedLevel : baseLevel;

      std::string rawOut = renderValue(evalValue, fmtCopy); // Raw eval of getter

      // Get label based on predicate
      const std::string& displayOut = (tripped && !ov.label.empty()) ? ov.label : labelCopy;

      return std::make_tuple(lvl, std::move(rawOut), std::move(displayOut), tripped);
    });
    w.evalMutex = std::make_shared<pros::Mutex>();

    m_watches.push_back(std::move(w));
    return w.id;
  }

  /// @brief Print all watches that are due (and/or changed).
  void printWatches();

  // ------------------------------------------------------------------------
  // Waypoint internals
  // ------------------------------------------------------------------------
  struct InternalWaypoint {
    /// @brief Internal ID
    WPId id{};

    /// @brief Name as inputted by user
    std::string name{};

    /// @brief Waypoint parameters
    WaypointParams params;

    /// @brief Creation time of the waypoint
    uint32_t startTimeMs;

    /// @brief Is the waypoint active (not yet reached or timed out)?
    bool active = true;

    /// @brief Used for limiting .retriggerable waypoints
    bool prevReached = false;
    bool timedOut = false;
  };

  /// @brief Waypoint registry
  std::vector<InternalWaypoint> m_waypoints;

  WaypointHandle internalRegisterWaypoint(std::string name, WaypointParams details);

  /// @brief Get the offset of the robot in WaypointOffset from the WPId
  WaypointOffset getWaypointOffset(WPId id);

  /// @brief Get the name of the WatchId without taking m_mutex.
  std::optional<std::string> m_getWatchNameUnlocked(WatchId id, bool isElevated) const;

  /// @brief Get the roster label for an ID without taking m_mutex.
  std::optional<std::string> m_getRosterNameUnlocked(uint16_t id, bool isElevated) const;

  /// @brief Find a waypoint without taking m_mutex.
  InternalWaypoint* m_findWaypointUnlocked(WPId id);

  /// @brief Find a const waypoint without taking m_mutex.
  const InternalWaypoint* m_findWaypointUnlocked(WPId id) const;

  /// @brief Re-send the roster entry for a single waypoint.
  bool resyncWaypointRoster(WPId id);

  /// @brief Returns true if the robot has reached the WPId
  bool isWaypointReached(WPId id);

  /// @brief Print all waypoints that are due
  void printWaypoints();

  /**
   * @brief Emit a formatted log message. Automatically handles 
   *        terminal/SD logging.
   */
  void logMessage(const LogLevel level, const char *fmt, va_list args);

  /**
   * @brief Write a formatted log line to the SD log file.
   */
  _MVLIB_FORMAT_CHECK(3, 4)
  void logToSD(const LogLevel level, const char *fmt, ...);
  
  // ------------------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------------------

  LoggerConfig m_config{};
  LoggerTimings m_timings{};

  pros::Mutex m_sdMutex;
  pros::Mutex m_mutex;

  uint32_t m_lastFileFlush{0};
  FILE* m_sdFile = nullptr;
  char m_currentFilename[128] = "";
  char m_absoluteFilename[133] = "";
  const char* m_date = detail::getBuildDate(); 
  char m_loggingFolder[24] = "";

  volatile bool m_sdLocked = false;    // Has sd card failed?
  bool m_started = false;     // Has start() been called?
  std::atomic<bool> m_configSet{false};   // Has setRobot() been called?
  bool m_forceSpeedEstimation = false;

  std::atomic<bool> m_pauseRequested{false}; 
  
  // Robot refs
  pros::MotorGroup* m_pLeftDrivetrain = nullptr; 
  pros::MotorGroup* m_pRightDrivetrain = nullptr; 

  std::unique_ptr<pros::Task> m_task;

  // Position getters
  std::shared_ptr<std::function<std::optional<Pose>()>> m_getPose = nullptr;
  std::shared_ptr<pros::Mutex> m_poseGetterMutex = nullptr;
  
  uint32_t m_lastRosterFlush{0};
  uint32_t m_lastTerminalFlush{0};

  // Friend classes
  friend class WaypointHandle;
  friend class WatchHandle;
  friend class Telemetry;
};
} // namespace mvlib
