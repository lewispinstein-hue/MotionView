#pragma once
/**
 * @file core.hpp
 * @brief Core MVLib header. Provides the Logger singleton, watches, and 
 *
 * This header provides:
 * - A singleton logger (mvlib::Logger) that can print to the PROS terminal and/or
 *   write to an SD card file.
 * - Convenience log macros (LOG_INFO, LOG_WARN, ...) that route to mvlib::Logger.
 * - A lightweight "watch" system to periodically print variable values (or only
 *   when values change), with optional log-level elevation predicates.
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
 *   mvlib::setOdom([]() -> std::optional<Pose { ... });
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

#include <atomic>
#include <optional>
#include <utility>
#include <vector>
#include <string>

#define MVLIB_VERSION 100100L // 1.1.0

namespace mvlib {

namespace {

struct unique_lock {
  /// @brief Mutex reference managed by this guard.
  pros::Mutex& m;
  bool locked = false;
  explicit inline unique_lock(pros::Mutex& m) : m(m) { locked = m.take(); }
  explicit inline unique_lock(pros::Mutex& m, uint32_t timeout) : m(m) {
    locked = m.take(timeout);
  }
  ~unique_lock() { if (locked) m.give(); }

  bool isLocked() const { return locked; }
  bool unlock() {
    if (!locked) return false;
    return m.give();
  }

  unique_lock(const unique_lock&) = delete;
  unique_lock& operator=(const unique_lock&) = delete;
};

/// Workaround to force a static_assert to be type-dependent
template<class>
inline constexpr bool always_false_v = false;

#if __cplusplus >= 202302L
  #include <utility>
  #define _MVLIB_UNREACHABLE() std::unreachable()
#elif defined(__GNUC__) || defined(__clang__)
  #define _MVLIB_UNREACHABLE() __builtin_unreachable()
#elif defined(_MSC_VER)
  #define _MVLIB_UNREACHABLE() __assume(false)
#else
  #define _MVLIB_UNREACHABLE()
#endif

// Attribute for printf format checks
#if defined(__GNUC__) || defined(__clang__)
  #define _MVLIB_PRINTF_CHECK(fmt_idx, arg_idx) __attribute__((format(printf, fmt_idx, arg_idx)))
#else
  #define _MVLIB_PRINTF_CHECK(fmt_idx, arg_idx) 
#endif
} // namespace

/**
 * @enum LogLevel
 * @brief Log severity levels used for filtering and formatting.
 *
 * @note Ordering matters: higher values are considered "more severe".
 */
enum class LogLevel : uint8_t {
  NONE = 0,    /// The lowest log level. Used for simply disabling logger.
  OFF = NONE,  /// Alias for NONE
  DEBUG,       /// Used for info related to startup and diagnostics
  INFO,        /// The most frequently used log level. 
  WARN,        /// Used for logs still not dangerous, but that should stand out
  ERROR,       /// Used when something has gone wrong.
  FATAL,       /// Used only for serious failures; often precedes a force stop.
  OVERRIDE = 0xFF /// Used by system for overriding minLogLevel
};

// ---------- Generic variable watches ----------
using WatchId = uint64_t;

/**
 * @struct LevelOverride
 * @brief Optional log-level override applied to a watch sample.
 *
 * A watch has a base log level (e.g., INFO). If predicate(expression) evaluates to
 * true, the watch sample is emitted at elevatedLevel instead.
 */
template<class T> 
struct LevelOverride {
  /// @brief Level used when predicate returns true.
  LogLevel elevatedLevel = LogLevel::WARN;

  /// @brief Predicate to decide if a sample should be emitted at elevatedLevel.
  std::function<bool(const T &)> predicate;

  /// @brief An optional label that prints instead of the regular when the predicate is true.
  std::string label;
};

/**
 * @def PREDICATE
 * @brief Helper for building a LevelOverride predicate with an int input.
 *
 * Where to use it:
 * - When using watch() with integer-like values and you want a concise predicate.
 *
 * @note This macro is limited to predicates over int32_t. For other types, use
 *       mvlib::asPredicate<Typename>(expression) directly.
 */
#define PREDICATE(func)                                                        \
  mvlib::asPredicate<int32_t>([](int32_t v) -> bool { return func; })

/**
 * @brief Convert an arbitrary predicate callable into std::function<bool(const T&)>.
 *
 * Where to use it:
 * - To pass lambdas/functions into LevelOverride in a type-erased form.
 *
 * @tparam T Predicate input type.
 * @tparam Pred Callable type (lambda, function pointer, functor).
 * @param p Predicate callable.
 * \return A std::function wrapper calling p(const T&).
 */
template<class T, class Pred>
std::function<bool(const T&)> asPredicate(Pred &&p) {
  return std::function<bool(const T&)>(std::forward<Pred>(p));
}

/**
 * @struct Pose struct used internally that represents the robot's x, y, and theta values.
*/
struct Pose {
  double x{0};
  double y{0};
  double theta{0};
};

/**
 * @class Logger
 * @brief Singleton logging + telemetry manager.
 */
class Logger {
public:
  using LogLevel = ::mvlib::LogLevel;

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

  /**
   * @struct Drivetrain
   * @brief References to robot components used by telemetry helpers.
   */
  struct Drivetrain {
    /// @brief Left drivetrain motors for velocity.
    pros::MotorGroup *leftDrivetrain;

    /// @brief Right drivetrain motors for velocity. 
    pros::MotorGroup *rightDrivetrain;
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
  void pause(bool byForce = false);

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
   * @note Many implementations lock SD logging after start() to avoid file
   *       lifecycle issues. Calls after start() may fail.
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
   * @struct LoggerTimings
   * @brief Runtime configuration for Logger output and update loops.
   *
   * @note All timings are in ms.
  */
  struct LoggerTimings {
    /**
     * @brief SD file flush interval. At 1s (default), 
     *        SD card flushes out of RAM every 1 second.
    */
    uint32_t sd_buffer_flush_interval = 1000;

    /**
     * @brief Controls how often mvlib polls for new data and logs it. Default: 120ms
     *
     * @note This interval overrides the sd card interval. If logging to 
     *       terminal and to sd card, the terminal polling rate is used.
     *
     * @warning If the polling rate is too fast, it may overwhelm the 
     *          brain -> controller connection, which may cause the
     *          connection to be completely dropped and cease logging 
     *          or transmission lag.
    */
    uint32_t sd_polling_rate = 80;

    /**
     * @brief Controls how often mvlib polls for new data and logs it. Default: 80ms
     *
     * @note Sd card output is buffered by SD_FLUSH_INTERVAL_MS. This only 
     *       controls how often that buffer is written too. Faster polling
     *       rates may lead to resource starvation of other tasks.
    */
    uint32_t terminal_polling_rate = 120;
  };

  /**
   * @brief Set the runtime configuration for Logger output and update loops.
   */
  void setTimings(LoggerTimings timings);

  /**
   * @brief Set the minimum log level that will be emitted. Useful for
   *       Whenever you want to filter out logs that are not important to you.
  */
  void setLoggerMinLevel(LogLevel level);

  // ------------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------------

  /**
   * @brief Provide a custom pose getter (for any odometry library).
   * @param getter Callable that returns a Pose or std::nullopt if unavailable.
   *
   * @note Prefer the adapters based on you odom library from include/mvlib/Optional
   *
   * \b Example
   * @code
   * // LemLib example
   * #include "mvlib/api.hpp"
   * #include "lemlib/api.hpp"
   * lemlib::Chassis chassis (...);
   * void initialize() {
   *   auto& logger = mvlib::Logger::getInstance();
   *   logger.setPoseGetter([&]() -> std::optional<mvlib::Pose> {
   *     lemlib::Pose pose = chassis.getPose(); 
   *     if (!std::isfinite(pose.x) || !std::isfinite(pose.y)) return std::nullopt;
   *     return mvlib::Pose(pose.x, pose.y, pose.theta);
   *   });
   * }
   * @endcode
  */
  void setPoseGetter(std::function<std::optional<Pose>()> getter);

  /**
   * @brief Provide robot component references used by telemetry helpers.
   * @param drivetrain drivetrain refs.
   * \return True if refs were accepted (e.g., non-null and consistent).
   *
   * @note If you do not call this, drivetrain speed will be approximated from 
   *       pose. This is not recommended.
   */
  bool setRobot(Drivetrain drivetrain, bool useSpeedEstimation = false);

  // ------------------------------------------------------------------------
  // Logging
  // ------------------------------------------------------------------------

  /**
   * @brief Emit a computer-formatted log message to MotionView. Unlike the LOG_
   *        macros, these function will produce logs MotionView will parse and 
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
   * auto& logger = mvlib::Logger::getInstance();
   * logger.debug("Hello, %s", "world");
   * logger.info("Battery Temp: %.1f", pros::battery::get_temperature());
   * @endcode
  */
  _MVLIB_PRINTF_CHECK(2, 3)
  void debug(const char *fmt, ...);

  /** 
  * @copydoc debug
  * @brief Emit info level log message.
  */
  _MVLIB_PRINTF_CHECK(2, 3)
  void info(const char *fmt, ...);

  /** 
  * @copydoc debug
  * @brief Emit warning level log message.
  */
  _MVLIB_PRINTF_CHECK(2, 3)
  void warn(const char *fmt, ...);

  /** 
  * @copydoc debug
  * @brief Emit error level log message.
  */
  _MVLIB_PRINTF_CHECK(2, 3)
  void error(const char *fmt, ...);

  /** 
  * @copydoc debug 
  * @brief Emit fatal level log message.
  */
  _MVLIB_PRINTF_CHECK(2, 3)
  void fatal(const char *fmt, ...);

  // ------------------------------------------------------------------------
  // Waypoints
  // ------------------------------------------------------------------------
  
  /**
   * @brief Add a waypoint to the logger.
   * @param name Name of the waypoint.
   * @param details Required waypoint details (x, y, theta, tol, etx)
   * @return A handle to the waypoint.
   *
   * @note To access value of the waypoint, use the handle returned by this 
   *       function.
   *
   * @warning @c name is moved into the handle. Do not use @c name after passing 
   *          it to this function.
   *
   * \b Example
   * @code
   * auto& logger = mvlib::Logger::getInstance();
   * auto BL_MTL = logger.addWaypoint("Blue left matchloader", {
   *   .tarX = 70, 
   *   .tarY = -47, 
   *   .tarT = 0,
   *   .linearTol = 2,
   *   .thetaTol = 10,
   *   .timeoutMs = 5_mvS,
   *   .printOffsetEveryMs = 1_mvS
   * });
   * auto off = BL_MTL.getOffset();
   * printf("BL_MTL CURRENT OFFSET: %.1f, %.1f, %.1f.\n", off.offX, off.offY, off.offT.value());
   * @endcode
   * This example creates a waypoint named "Blue left matchloader" with a 
   * target position of (70, -47), XY tolerance of 2, theta tolerance of 
   * 10 degrees, and a timeout of 5 seconds. It will also print the offset
   * every 1000ms to MotionView.
   */
  WaypointHandle addWaypoint(std::string name, WaypointParams details);
  
  // ------------------------------------------------------------------------
  // Watches
  // ------------------------------------------------------------------------

  struct DefaultWatches {
    bool leftDrivetrainWatchdog  = true;
    bool rightDrivetrainWatchdog = true;
    bool batteryWatchdog         = true;
  };

  /**
   * @brief Set default log levels for common components.
   * @return True if successful.
   */
  bool setDefaultWatches(const DefaultWatches& watches);

  /**
   * @brief Register a periodic watch on a getter function. The 
   *        getter is sampled every intervalMs and printed at baseLevel, unless
   *        the optional override predicate elevates the level.
   *
   * @note Adding a watch is computationally expensive. Don't call logger.watch() 
   *       repeatedly. Additionally, if the same .watch() is called 
   *       multible times, each watch will be separate and logged independently.
   *
   * @tparam Getter Callable that returns the value to render (numeric/bool/string/cstr).
   * @param label Display label for the watch.
   * @param baseLevel Level used for normal samples.
   * @param intervalMs Sampling/print interval in ms.
   * @param getter Callable returning a value.
   * @param ov Optional LevelOverride (type inferred from getter).
   * @param fmt Optional printf-style format for numeric values (e.g. "%.2f").
   *
   * \return WatchId that can be used to identify the watch internally.
   *
   * \b Example
   * @code
   * auto& logger = mvlib::Logger::getInstance();
   * logger.watch("Intake RPM:", mvlib::LogLevel::INFO, 1_mvS, 
   * [&]() { return left_mg.get_actual_velocity(); },
   * mvlib::LevelOverride<double>{
   * .elevatedLevel = mvlib::LogLevel::WARN,
   * .predicate = PREDICATE(v > 550),
   * .label = "Intake RPM over 550:"},
   * "%.0f");
   * @endcode
   */
  template<class Getter, class U>
    requires std::invocable<Getter&> &&
             std::same_as<std::decay_t<U>,
             std::decay_t<std::invoke_result_t<Getter&>>>
  WatchId watch(std::string label, LogLevel baseLevel, uint32_t intervalMs,
        Getter &&getter, LevelOverride<U> ov = {}, std::string fmt = {}) {
    using T = std::decay_t<std::invoke_result_t<Getter &>>;

    return addWatch<T>(std::move(label), baseLevel, intervalMs,
                       std::forward<Getter>(getter), std::move(ov),
                       std::move(fmt));
  }

  /**
   * @brief Register a watch that prints only when the rendered value changes.
   *
   * @note Adding a watch is computationally expensive. Don't call 
   *       logger.watch() repeatedly. If the same .watch() is called 
   *       multible times, each watch will be separate and logged independently.
   *
   * @tparam Getter Callable that returns the value to render.
   * @param label Display label for the watch.
   * @param baseLevel Level used for normal samples.
   * @param onChange If true, prints only on value change (interval ignored).
   * @param getter Callable returning a value.
   * @param ov Optional LevelOverride (type inferred from getter).
   * @param fmt Optional printf-style format for numeric values.
   * \return WatchId of the registered watch.
   */
  template<class Getter, class U>
    requires std::invocable<Getter&> &&
             std::same_as<std::decay_t<U>,
             std::decay_t<std::invoke_result_t<Getter&>>>
  WatchId watch(std::string label, LogLevel baseLevel, bool onChange, 
                Getter&& getter, LevelOverride<U> ov, std::string fmt = {}) { 
                  
    using T = std::decay_t<std::invoke_result_t<Getter&>>;
    return addWatch<T>(std::move(label), baseLevel, uint32_t{0},
                       std::forward<Getter>(getter), std::move(ov),
                       std::move(fmt), onChange);
  }

  // Error catching 
  template<class Getter, class U>
    requires std::invocable<Getter&> &&
            (!std::same_as<std::decay_t<U>, 
            std::decay_t<std::invoke_result_t<Getter&>>>)
  WatchId watch(std::string, LogLevel, uint32_t, Getter&&, LevelOverride<U>, std::string = {}) {
    static_assert(always_false_v<U>,
                "\n\n\n------------------------------------------------------------------------"
                "\nLogger::watch(...): LevelOverride<Type> type mismatch.\n"
                "Type of LevelOverride must match the getter's return type (after decay).\n"
                "------------------------------------------------------------------------\n\n\n");
    return -1;
  }

  template<class Getter, class U>
    requires std::invocable<Getter&> &&
            (!std::same_as<std::decay_t<U>, 
            std::decay_t<std::invoke_result_t<Getter&>>>)
  WatchId watch(std::string, LogLevel, bool, Getter&&, LevelOverride<U>, std::string = {}) {
    static_assert(always_false_v<U>,
                "\n\n\n------------------------------------------------------------------------"
                "\nLogger::watch(...): LevelOverride<Type> type mismatch.\n"
                "Type of LevelOverride must match the getter's return type (after decay).\n"
                "------------------------------------------------------------------------\n\n\n");
    return -1;
  }

private:
  Logger();
  Logger(const Logger&) = delete;
  Logger& operator=(const Logger&) = delete;

  /// @brief Background update loop invoked by the logger task.
  void Update();

  /// @brief Validate that required robot references are present.
  bool m_checkRobotConfig();

  /// @brief Initialize SD logger file handle and state.
  bool m_initSDLogger();

  /// @brief Return the current sessions filename.
  std::string m_getTimestampedFile();

  /**
   * @brief Convert a LogLevel to a printable string.
   * @param level Log level to convert.
   * \return C-string representation of the level.
   */
  const char *m_levelToString(const LogLevel& level) const;

  /**
   * @struct Watch
   * @brief Internal watch record.
   */
  struct InternalWatch {
    WatchId id{};                       /// @brief Watch identifier.
    std::string label;                  /// @brief Watch display label.
    LogLevel baseLevel{LogLevel::INFO}; /// @brief Base log level for normal samples.
    uint32_t intervalMs{1000};          /// @brief Print interval (ms) when not onChange.
    uint32_t lastPrintMs{0};            /// @brief Last print timestamp (ms).
    std::string fmt;                    /// @brief Optional numeric format string.

    bool onChange = false;             /// @brief If true, prints only when value changes.
    std::optional<std::string> lastValue = std::nullopt; /// @brief Last rendered value (for onChange).

    /// @brief Computes (level, rendered eval string, label) for the current sample.
    std::function<std::tuple<LogLevel, std::string, std::string>()> eval;
  };

  /// @brief Next watch id to assign.
  WatchId m_nextId = 1;

  /// @brief Watch registry keyed by WatchId.
  std::vector<InternalWatch> m_watches;

  // --- core builder ---

  /**
   * @brief Internal watch registration routine.
   *
   * @tparam T Watch value type.
   * @tparam Getter Getter callable type.
   * @param label Display label.
   * @param baseLevel Base log level.
   * @param intervalMs Interval in ms (ignored when onChange=true).
   * @param getter Getter callable.
   * @param ov Optional override predicate/level.
   * @param fmt Optional numeric format.
   * @param onChange If true, print only on change.
   * \return Assigned WatchId.
   *
   * @note If the watch failed to add, it will return (uint64_t)-1.
   */
  template <class T, class Getter>
  WatchId addWatch(std::string label, const LogLevel baseLevel, 
                   const uint32_t intervalMs, Getter &&getter, 
                   LevelOverride<T> ov, std::string fmt,
                   bool onChange = false) {
    unique_lock lock(m_mutex);
    if (!lock.isLocked()) return -1;
  
    InternalWatch w;
    w.id = m_nextId++;
    w.label = std::move(label);
    w.baseLevel = baseLevel;
    w.intervalMs = intervalMs;
    w.onChange = onChange;
    w.fmt = std::move(fmt);

    using G = std::decay_t<Getter>;
    G g = std::forward<Getter>(getter); // store callable by value

    // Capture fmt by value (not by reference to w), and move ov in.
    const std::string fmtCopy = w.fmt;
    const std::string labelCopy = w.label;

    // When w.eval is called, it returns final log level, getter eval, final label
    w.eval = [baseLevel, labelCopy, fmtCopy, g = std::move(g), 
              ov = std::move(ov)]() mutable -> 
              std::tuple<LogLevel, std::string, std::string> {

      T v = static_cast<T>(g());

      const bool tripped = (ov.predicate && ov.predicate(v));

      // Log level based on predicate
      LogLevel lvl = tripped ? ov.elevatedLevel : baseLevel;

      std::string rawOut = renderValue(v, fmtCopy); // Raw eval of getter

      // Get label based on predicate 
      std::string displayOut = (tripped && !ov.label.empty()) ? ov.label : labelCopy;

      return {lvl, std::move(rawOut), std::move(displayOut)};
    };

    WatchId id = w.id;
    m_watches.push_back(std::move(w));
    return id;
  }

  /// @brief Print all watches that are due (and/or changed).
  void printWatches();


  // ------------------------------------------------------------------------
  // Waypoint internals
  // ------------------------------------------------------------------------
  struct InternalWaypoint {
    WPId id{};               /// Internal ID
    std::string name{};      /// Name as inputted by user
    WaypointParams params;   /// Waypoint parameters
    uint32_t lastPrintMs{};  /// Last time the waypoint was printed (params.printOffsetEveryMs)
    uint32_t startTimeMs;    /// Creation time of the waypoint
    bool active = true;      /// Is the waypoint active (not yet reached or timed out)?
    bool prevReached = false;
  };

  /// @brief Waypoint registry
  std::vector<InternalWaypoint> m_waypoints;

  /// @brief Get the offset of the robot in WaypointOffset from the WPId
  WaypointOffset getWaypointOffset(WPId id);

  /// @brief Get the prevReached variable 
  bool isPrevReached(WPId id);

  /// @brief Set the prevReached variable. 
  /// \return false on invalid Id, true otherwise
  bool setPrevReached(WPId id, bool value);

  /// @brief Get the params of the WPId 
  WaypointParams getWaypointParams(WPId id);

  /// @brief Get the name of the WPId
  std::string getWaypointName(WPId id);

  /// @brief Returns true if the robot has reached the WPId
  bool isWaypointReached(WPId id);

  /// @brief Returns true if the WPId is actively being tracked
  bool isWaypointActive(WPId id);

  /// @brief Print all waypoints that are due
  void printWaypoints();

  /**
   * @brief Emit a formatted log message. Automatically handles 
   *        terminal/SD logging.
   */
  _MVLIB_PRINTF_CHECK(3, 4)
  void logMessage(const LogLevel& level, const char *fmt, ...);

  /**
   * @brief Write a formatted log line to the SD log file.
   */
  _MVLIB_PRINTF_CHECK(3, 4)
  void logToSD(const LogLevel& level, const char *fmt, ...);
  
  // ------------------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------------------

  LoggerConfig m_config{};
  LoggerTimings m_timings{};
  LogLevel m_minLogLevel = LogLevel::INFO;

  /** 
   * @note A different mutex is needed for sd and terminal 
   *       because user can call independently of system, leading 
   *       to deadlocks / race conditions
  */
  pros::Mutex m_terminalMutex;
  pros::Mutex m_sdMutex;
  pros::Mutex m_mutex;

  uint32_t m_lastFileFlush{0};
  FILE *m_sdFile = nullptr;
  char m_currentFilename[128] = "";
  const char *date = __DATE__; // Last upload date as fallback for no RTC

  volatile bool m_sdLocked = false;    // Has sd card failed?
  bool m_started = false;     // Has start() been called?
  bool m_configSet = false;   // Has setRobot() been called?
  bool m_configValid = false; // Is drivetrain config valid?
  bool m_forceSpeedEstimation = false;

  std::atomic<bool> m_pauseRequested{false}; 
  
  // Robot refs
  pros::MotorGroup *m_pLeftDrivetrain = nullptr; 
  pros::MotorGroup *m_pRightDrivetrain = nullptr; 

  std::unique_ptr<pros::Task> m_task;

  // Position getters
  std::function<std::optional<Pose>()> m_getPose = nullptr;
  
  // Friend classes
  friend class WaypointHandle;
};
} // namespace mvlib
