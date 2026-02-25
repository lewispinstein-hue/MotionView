#pragma once
/**
 * @file core.hpp
 * @brief Logging + telemetry utilities for PROS robots.
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
 * When to use it:
 * - When you need structured, rate-limited logging without sprinkling printfs.
 * - When you want a single place to control log verbosity and outputs.
 *
 * @note This logger is designed for PROS projects. It expects PROS RTOS
 *       primitives (pros::Task, pros::Mutex) and an optional pose provider.
 *
 * @warning If you need to manually include okapi's api.hpp, you MUST include  
 *          core.hpp at the very end of the includes. This is to prevent OkApi's 
 *          LOG macros from interfering and causing errors with mvlib's LOG macros.
 *
 * \b Example
 * @code
 * #include "mvlib/core.hpp"
 *
 * void initialize() {
 *   auto& logger = mvlib::Logger::getInstance();
 *
 *   // Set the drivetrain 
 *   logger.setRobot({
 *     .LeftDrivetrain = leftDrive,
 *     .RightDrivetrain = rightDrive
 *   });
 *
 *   logger.start();
 * }
 * @endcode
 */

#include "pros/motor_group.hpp" // IWYU pragma: keep
#include "pros/rtos.hpp"        // IWYU pragma: keep

#include <optional>
#include <atomic>
#include <optional>
#include <utility>

#define _LOGGER_CORE
namespace mvlib {

// --------------------------------------------------------------------------
// Convenience log macros
// --------------------------------------------------------------------------

/**
 * @defgroup LoggingMacros Logging Macros
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

#else
#define MVLIB_LOGS_REDEFINED

#define MVLIB_LOG_DEBUG(fmt, ...)                                                    \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::DEBUG, fmt, ##__VA_ARGS__)

#define MVLIB_LOG_INFO(fmt, ...)                                                     \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::INFO, fmt, ##__VA_ARGS__)

#define MVLIB_LOG_WARN(fmt, ...)                                                     \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::WARN, fmt, ##__VA_ARGS__)

#define MVLIB_LOG_ERROR(fmt, ...)                                                    \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::ERROR, fmt, ##__VA_ARGS__)

#define MVLIB_LOG_FATAL(fmt, ...)                                                    \
  mvlib::Logger::getInstance().logMessage(                                     \
      mvlib::LogLevel::FATAL, fmt, ##__VA_ARGS__)
#endif
/** @} */

namespace {

struct MutexGuard {
  /// @brief Mutex reference managed by this guard.
  pros::Mutex &m;
  bool locked = false;
  explicit inline MutexGuard(pros::Mutex &m) : m(m) { locked = m.take(); }
  explicit inline MutexGuard(pros::Mutex &m, uint32_t timeout) : m(m) {
    locked = m.take(timeout);
  }
  ~MutexGuard() { if (locked) m.give(); }

  bool isLocked() const { return locked; }

  MutexGuard(const MutexGuard &) = delete;
  MutexGuard &operator=(const MutexGuard &) = delete;
};

/// Workaround to force a static_assert to be type-dependent
template<class>
inline constexpr bool always_false_v = false;

#if __cplusplus >= 202302L
    #include <utility>
    #define UNREACHABLE() std::unreachable()
#elif defined(__GNUC__) || defined(__clang__)
    #define UNREACHABLE() __builtin_unreachable()
#elif defined(_MSC_VER)
    #define UNREACHABLE() __assume(false)
#else
    #define UNREACHABLE() do {} while () // Fallback
#endif
}

/**
 * @enum LogLevel
 * @brief Log severity levels used for filtering and formatting.
 *
 * @note Ordering matters: higher values are considered "more severe".
 */
enum class LogLevel {
  NONE = 0, /// The lowest log level. Used for simply disabling logger.
  OFF = 0,  /// Alias for NONE
  DEBUG,    /// Used for info related to startup and diagnostics
  INFO,     /// The most frequently used log level. 
  WARN,     /// Used for logs still not dangerous, but that should stand out
  ERROR,    /// Used when something has gone wrong.
  FATAL     /// Used only for serious failures; often precedes a force stop.
}; 

/// @brief SD file flush interval (ms). At 1000ms (default), SD card flushes out of RAM every 1 second.
constexpr uint32_t SD_FLUSH_INTERVAL_MS = 1000;

// ---------- Generic variable watches ----------

/// @brief Identifier for a registered watch entry.
using WatchId = uint64_t;

/**
 * @brief Wrap a global/static object pointer into a non-owning std::shared_ptr.
 *
 * Where to use it:
 * - For Logger::setRobot(), which expects std::shared_ptr references.
 *
 * When to use it:
 * - When you have an object with static/storage lifetime and you want to pass it
 *   into the logger without transferring ownership.
 *
 * @note This does NOT take ownership. The deleter is a no-op. The referenced
 *       object must outlive the shared_ptr and any Logger usage. The best way
 *       to do this is by making the object global.
 *
 * \b Example (global lifetime):
 * @code
 * pros::MotorGroup left(...);
 * pros::MotorGroup right(...);
 *
 * void initialize() {
 *   auto& logger = mvlib::Logger::getInstance();
 *   logger.setRobot({
 *     .LeftDrivetrain = mvlib::shared(left),
 *     .RightDrivetrain = mvlib::shared(right)
 *   });
 * }
 * @endcode
 */
 
template <class T>
std::shared_ptr<std::remove_reference_t<T>> shared(T& obj) {
  using U = std::remove_reference_t<T>;
  return std::shared_ptr<U>(std::addressof(obj), [](U*) {}); // no-op deleter
}

/**
 * @def PREDICATE
 * @brief Helper for building a LevelOverride predicate with an int input.
 *
 * Where to use it:
 * - When using watch() with integer-like values and you want a concise predicate.
 *
 * @note This macro is limited to predicates over int32_t. For other types, use
 *       mvlib::as_predicate<Typename>(expression) directly.
 */
#define PREDICATE(func) \
mvlib::as_predicate<int32_t>([](int32_t v) { return func; })

/**
 * @struct LevelOverride
 * @brief Optional log-level override applied to a watch sample.
 *
 * A watch has a base log level (e.g., INFO). If predicate(expression) evaluates to
 * true, the watch sample is emitted at elevatedLevel instead.
 *
 * Where to use it:
 * - In watches where you want "normal" printing at INFO, but highlight abnormal
 *   values at WARN/ERROR.
 */
template <class T> struct LevelOverride {
  using value_type = T;

  /// @brief Level used when predicate returns true.
  LogLevel elevatedLevel = LogLevel::WARN;

  /// @brief Predicate to decide if a sample should be emitted at elevatedLevel.
  std::function<bool(const T &)> predicate;

  /// @brief An optional label that prints instead of the regular when the predicate is true.
  std::string label;
};

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
template <class T, class Pred>
std::function<bool(const T &)> as_predicate(Pred &&p) {
  return std::function<bool(const T &)>(std::forward<Pred>(p));
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
 *
 * Where to use it:
 * - As the single source of truth for logging configuration.
 * - As a central place for periodic telemetry (pose, battery, tasks, watches).
 *
 * When to use it:
 * - Prefer it for on-robot debug output instead of scattered printf calls.
 * - Use watches for values you want sampled at a controlled cadence.
 *
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
  struct loggerConfig {
    std::atomic<bool> logToTerminal{true};               ///< @brief Print logs to the terminal.
    std::atomic<bool> logToSD{true};                     ///< @brief Write logs to SD (locked after logger start).
    std::atomic<bool> printWatches{true};                ///< @brief Print registered watches.
  };

  /**
   * @struct Drivetrain
   * @brief References to robot components used by telemetry helpers.
   */
  struct Drivetrain {
    std::shared_ptr<pros::MotorGroup> LeftDrivetrain;   ///< @brief Left drivetrain motors for thermal scanning.
    std::shared_ptr<pros::MotorGroup> RightDrivetrain;  ///< @brief Right drivetrain motors for thermal scanning.
  };

  /**
   * @brief Access the singleton logger instance.
   * \return Reference to the global Logger instance.
   */
  [[nodiscard]] static Logger &getInstance();

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
  void unpause();

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
   *       lifecycle issues. If that applies, calls after start() may no-op.
   */
  void setLogToSD(bool v);

  /// @brief Enable/disable printing of registered watches.
  void setPrintWatches(bool v);

  // ------------------------------------------------------------------------
  // Log filtering
  // ------------------------------------------------------------------------

  /**
   * @brief Set the minimum log level that will be emitted.
   *
   * Where to use it:
   * - Whenever you want to filter out logs that are not important to you.
   */
  void setLoggerMinLevel(LogLevel level);

  // ------------------------------------------------------------------------
  // Robot + motors
  // ------------------------------------------------------------------------

  /**
   * @brief Provide a custom pose getter (for any odometry library).
   * @param getter Callable that returns a Pose or std::nullopt if unavailable.
   *
   * @note Use the functions for your respective odom library from mvlib/Optional. 
   *
   * \b Example
   * @code
   * // LemLib example
   * #include "mvlib/Optional/logger_optional_lemlib.hpp"
   * #include "lemlib/api.hpp"
   * lemlib::Chassis chassis (...);
   * void initialize() {
   *   auto& logger = mvlib::Logger::getInstance();
   *   mvlib::setOdom(logger, &chassis);
   * }
   * @endcode
   */
  void setPoseGetter(std::function<std::optional<Pose>()> getter);

  /**
   * @brief Provide robot component references used by telemetry helpers.
   * @param drivetrain drivetrain refs (shared_ptr).
   * \return True if refs were accepted (e.g., non-null and consistent).
   *
   * @note If you do not call this, pose printing and some watchdog features may
   *       be disabled or will no-op.
   */
  bool setRobot(Drivetrain drivetrain);

  // ------------------------------------------------------------------------
  // Logging
  // ------------------------------------------------------------------------

  /**
   * @brief Emit a formatted log message.
   *
   * @param level Log severity.
   * @param fmt printf-style format string.
   */
  void logMessage(LogLevel level, const char *fmt, ...);

  /**
   * @brief Write a formatted log line to the SD log file.
   *
   * @note This is typically called by logMessage() when SD logging is enabled.
   * @param levelStr Preformatted level string (e.g., "INFO").
   * @param fmt printf-style format string.
   */
  void logToSD(const char *levelStr, const char *fmt, ...);

  // ------------------------------------------------------------------------
  // Watches
  // ------------------------------------------------------------------------

  /**
   * @brief Register a periodic watch on a getter function.
   *
   * The getter is sampled every intervalMs and printed at baseLevel, unless
   * the optional override predicate elevates the level.
   *
   * @tparam Getter Callable that returns the value to render (numeric/bool/string/cstr).
   * @param label Display label for the watch.
   * @param baseLevel Level used for normal samples.
   * @param intervalMs Sampling/print interval in ms.
   * @param getter Callable returning a value.
   * @param ov Optional LevelOverride (type inferred from getter).
   * @param fmt Optional printf-style format for numeric values (e.g. "%.2f").
   * \return WatchId that can be used to identify the watch internally.
   *
   * \b Example
   * @code
   * auto& logger = mvlib::Logger::getInstance();
   * logger.watch("Intake RPM:", mvlib::LogLevel::INFO, 
   * uint32_t{1000}, // The uint32_t{} is needed to disambiguate the overload
   * [&](){ return left_mg.get_actual_velocity(); },
   * mvlib::LevelOverride<double>{
   * .elevatedLevel = mvlib::LogLevel::WARN,
   * .predicate = PREDICATE(v > 550),
   * .label = "Intake RPM over 550:"},
   * "%.0f");
   * @endcode
   */
  template <class Getter, class U>
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
   * @tparam Getter Callable that returns the value to render.
   * @param label Display label for the watch.
   * @param baseLevel Level used for normal samples.
   * @param onChange If true, prints only on value change (interval ignored).
   * @param getter Callable returning a value.
   * @param ov Optional LevelOverride (type inferred from getter).
   * @param fmt Optional printf-style format for numeric values.
   * \return WatchId of the registered watch.
   */
  template <class Getter, class U>
    requires std::invocable<Getter&> &&
             std::same_as<std::decay_t<U>,
             std::decay_t<std::invoke_result_t<Getter&>>>
  WatchId watch(std::string label, LogLevel baseLevel, bool onChange, 
                Getter&& getter, LevelOverride<U> ov, std::string fmt = {}) { 
    using T = std::decay_t<std::invoke_result_t<Getter&>>;
    return addWatch<T>(std::move(label), baseLevel, 0,
                      std::forward<Getter>(getter), std::move(ov),
                      std::move(fmt), onChange);
  }

  // Error catching 
  template <class Getter, class U>
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

  template <class Getter, class U>
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
  Logger() = default;
  Logger(const Logger &) = delete;
  Logger &operator=(const Logger &) = delete;

  /// @brief Background update loop invoked by the logger task.
  void Update();

  /// @brief Validate that required robot references are present.
  bool m_checkRobotConfig();

  /// @brief Initialize SD logger file handle and state.
  bool m_initSDLogger();

  /// @brief Generate a timestamped filename into m_currentFilename.
  void m_makeTimestampedFilename();

  /**
   * @brief Convert a LogLevel to a printable string.
   * @param level Log level to convert.
   * \return C-string representation of the level.
   */
  const char *m_levelToString(LogLevel level) const;

  /**
   * @struct Watch
   * @brief Internal watch record.
   */
  struct Watch {
    WatchId id{};                       ///< @brief Watch identifier.
    std::string label;                  ///< @brief Watch display label.
    LogLevel baseLevel{LogLevel::INFO}; ///< @brief Base log level for normal samples.
    uint32_t intervalMs{1000};          ///< @brief Print interval (ms) when not onChange.
    uint32_t lastPrintMs{0};            ///< @brief Last print timestamp (ms).
    std::string fmt;                    ///< @brief Optional numeric format string.

    bool onChange = false;             ///< @brief If true, prints only when value changes.
    std::optional<std::string> lastValue = std::nullopt; ///< @brief Last rendered value (for onChange).

    /// @brief Computes (level, rendered string) for the current sample.
    std::function<std::tuple<LogLevel, std::string, std::string>()> eval;
  };

  /// @brief Next watch id to assign.
  WatchId m_nextId = 1;

  /// @brief Watch registry keyed by WatchId.
  std::unordered_map<WatchId, Watch> m_watches;

  // --- rendering helpers ---

  /**
   * @brief Render a std::string as-is.
   * \return The rendered string.
   */
  static std::string renderValue(const std::string &v, const std::string &) {
    return v;
  }

  /**
   * @brief Render a C-string safely.
   * \return "(null)" if v is nullptr, otherwise v as std::string.
   */
  static std::string renderValue(const char *v, const std::string &) {
    return v ? std::string(v) : std::string("(null)");
  }

  /**
   * @brief Render a boolean as "true"/"false".
   * \return Rendered boolean string.
   */
  static std::string renderValue(bool v, const std::string &) {
    return v ? "true" : "false";
  }

  /**
   * @brief Render arithmetic types using an optional printf-style format.
   *
   * @tparam T Value type.
   * @param v Value to render.
   * @param fmt Optional printf-style format string.
   * \return Rendered value string.
   *
   * @note Non-arithmetic types fall back to "<unrenderable>".
   */
  template <class T>
  static std::string renderValue(const T& v, const std::string& fmt) {
    if constexpr (std::is_floating_point_v<T>) {
      if (!fmt.empty()) {
        char buf[256];
        std::snprintf(buf, sizeof(buf), fmt.c_str(), (double)v);
        return std::string(buf);
      }
      return std::to_string((double)v);
    } else if constexpr (std::is_integral_v<T>) {
      (void)fmt; // ignore fmt for integrals
      return std::to_string((long long)v);
    } else {
      return std::string("<unrenderable>");
    }
  }


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
   */
  template <class T, class Getter>
  WatchId addWatch(std::string label, LogLevel baseLevel, uint32_t intervalMs,
                   Getter &&getter, LevelOverride<T> ov, std::string fmt,
                   bool onChange = false) {
    Watch w;
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

    w.eval = [baseLevel, labelCopy, fmtCopy, g = std::move(g), 
              ov = std::move(ov)]() mutable -> 
              std::tuple<LogLevel, std::string, std::string> {

      T v = static_cast<T>(g());

      const bool tripped = (ov.predicate && ov.predicate(v));

      LogLevel lvl = baseLevel;
      if (tripped) lvl = ov.elevatedLevel;

      std::string rawOut = renderValue(v, fmtCopy);

      // Get default label
      std::string displayOut = labelCopy;

      if (tripped && !ov.label.empty()) {
        displayOut = ov.label;
      }
      return {lvl, std::move(rawOut), std::move(displayOut)};
    };

    WatchId id = w.id;
    m_watches.emplace(id, std::move(w));
    return id;
  }

  /// @brief Print all watches that are due (and/or changed).
  void printWatches();

  // ------------------------------------------------------------------------
  // Internal state
  // ------------------------------------------------------------------------

  loggerConfig m_config{};           
  LogLevel m_minLogLevel = LogLevel::INFO;

  pros::Mutex m_logToSdMutex;       
  pros::Mutex m_loggerMutex;       
  pros::Mutex m_generalMutex;      

  uint32_t m_lastFlush = 0;   
  FILE *m_sdFile = nullptr;      
  char m_currentFilename[128] = "";   
  const char *date = __DATE__; // Last upload date as fallback for no RTC
  bool m_waitForSTDin = false;        
  bool m_started = false;
  bool m_sdLocked = false;
  bool m_configSet = false;
  bool m_configValid = false;
  
  // Polling intervals  
  /**
   * @brief Controls how often mvlib polls for new data and logs it.
   *         
   *
   * @note Time is in ms
   * @note This interval overrides the sd card interval. If logging to 
   *       terminal and to sd card, the terminal polling rate is used.
   *
   * @warning If the polling rate is too fast, it may overwhelm the 
   *          brain -> controller connection, which would cause the
   *          connection to be completely dropped and stop outputting.
  */
  static constexpr uint16_t terminalPollingRate = 120;

  /**
   * @brief Controls how often mvlib polls for new data and logs it.
   * 
   * @note Time is in ms
   * @note Sd card output is buffered by SD_FLUSH_INTERVAL_MS. This only 
   *       controls how often that buffer is written too. Faster polling
   *       rates may lead to starvation of other tasks.
  */
  static constexpr uint16_t sdCardPollingRate = 80; 

  // Robot refs
  std::shared_ptr<pros::MotorGroup> m_pLeftDrivetrain = nullptr; 
  std::shared_ptr<pros::MotorGroup> m_pRightDrivetrain = nullptr; 

  std::unique_ptr<pros::Task> m_task;

  // Position getters
  std::function<std::optional<Pose>()> m_getPose = nullptr;
};
} // namespace mvlib

/**
 * @brief Operator for .watch() intervalMs. Allows number_mvms 
 *        instead of uint32_t{number}
 *
 * \return explicit uint32_t casted version of the input number
 *
 * \b Example
 * @code{.cpp}
 * logger.watch("foo", mvlib::LogLevel::INFO, 100_mvms, ...);
 * @endcode
*/
constexpr uint32_t operator""_mvms(unsigned long long int ms) {
    return static_cast<uint32_t>(ms);
}
