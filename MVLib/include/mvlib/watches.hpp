#pragma once
/**
 * @file watches.hpp
 * @brief Contains user-facing information relating 
 *       to handling and creating watches
 */

#include <cstdint>
#include <functional>
#include <string>
#include "types.hpp"

namespace mvlib {
using WatchId = uint16_t;

/**
 * @struct LevelOverride
 * @brief Optional log-level override applied to a watch sample.
 *
 * A watch has a base log level (e.g., INFO). If predicate(expression) evaluates to
 * true, the watch sample is emitted at elevatedLevel instead.
 */
template <class T>
struct LevelOverride {
  /// @brief Level used when predicate returns true.
  LogLevel elevatedLevel = LogLevel::WARN;

  /// @brief Predicate to decide if a sample should be emitted at elevatedLevel.
  std::function<bool(const T&)> predicate;

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
template <class T, class Pred>
std::function<bool(const T&)> asPredicate(Pred&& p) {
  return std::function<bool(const T&)>(std::forward<Pred>(p));
}

/**
 * @enum WatchMode
 * @brief Controls how a watch decides when normal MVLib printing should emit it.
 */
enum class WatchMode : uint8_t {
  /// @brief Emit on a regular interval. `intervalMs` is the sample/print interval.
  onInterval = 0,

  /// @brief Emit only when the rendered value changes. `intervalMs` is the debounce interval.
  onChange
};

/**
 * @class WatchHandle
 * @brief A handle to a registered watch
 */
class WatchHandle {
private:
  /// Id of the handled watch
  WatchId m_id; 
  friend class Logger; 
  explicit WatchHandle(WatchId id) : m_id(id) {}

public:
  /**
   * @brief Check if the handle is valid. A watch is invalid if there
   *        was an error registering it (e.g. mutex lock failed to acquire).
   *
   * \return True if the watch is valid, false otherwise
   *
   * \b Example
   * @code{.cpp}
   * mvlib::WatchHandle watch = logger.watch(...);
   * if (!watch.valid()) {
   *   logger.warn("Watch is invalid!");
   * }
   * @endcode
   */
  bool valid() const;

  /**
   * @brief Check whether the watch is currently active.
   *        Inactive watches remain registered but will not be emitted.
   *
   * \return True if the watch is active, false otherwise.
   */
  bool active() const;

  /**
   * @brief Enable or disable the watch.
   *
   * @param v True to enable the watch, false to disable it.
   */
  void setActive(bool v);

  /**
   * @brief Get the watch interval in milliseconds.
   *        For on-change watches, this is the debounce interval.
   *
   * \return The watch interval in milliseconds.
   */
  uint32_t intervalMs() const;

  /**
   * @brief Get the watch emission behavior.
   *
   * \return The current watch type.
   */
  WatchMode type() const;

  /**
   * @brief Set the watch interval in milliseconds.
   *        For on-change watches, this sets the debounce interval.
   *
   * @param intervalMs The new interval in milliseconds.
   */
  void setIntervalMs(uint32_t intervalMs);

  /**
   * @brief Set the watch emission behavior.
   *
   * @param type The new watch type.
   */
  void setType(WatchMode type);

  /**
   * @brief Evaluate the watch immediately.
   *
   * @param emit If false, only returns the rendered value. If true,
   *             evaluates and emits the watch immediately.
   * \return The rendered watch value. Returns an empty string if evaluation fails.
   *
   * @note Direct watch evaluation runs the stored watch evaluator to preserve
   *       any internal watch state. While that evaluation is running, the main
   *       MVLib update loop cannot use the same watch mutex.
   *
   * \b Example
   * @code{.cpp}
   * mvlib::WatchHandle batteryWatch = logger.watch("Battery", LogLevel::INFO, WatchMode::onInterval, 1_mvS,
   *   []() { return pros::battery::get_voltage(); });
   *
   * std::string value = batteryWatch.evaluate();
   * batteryWatch.evaluate(true); // Force one immediate emit
   * @endcode
   */
  std::string evaluate(bool emit = false);

  /**
   * @brief Re-send this watch's roster entry over telemetry.
   *        This is useful if MotionView joined late and missed the watch name.
   *
   * \return True if the roster entry was successfully re-sent, false otherwise
   */
  bool resyncRoster() const;
};
} // namespace mvlib
