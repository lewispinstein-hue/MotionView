#pragma once
/**
 * @file raii.hpp
 * @brief Internal MVLib RAII helpers
 */
#include "pros/rtos.hpp"

namespace mvlib {
namespace detail {
struct uniqueLock {
  pros::Mutex& m;
  bool locked = false;

  explicit inline uniqueLock(pros::Mutex& m, uint32_t timeout = 0) : m(m) {
    locked = m.take(timeout);
  }
  
  ~uniqueLock() {
    if (locked) m.give();
  }

  bool isLocked() const {
    return locked;
  }

  bool unlock() {
    if (!locked) return false;
    locked = false;
    return m.give();
  }
  
  bool lock(uint32_t timeout = 0) {
    if (locked) return false;
    return (locked = m.take(timeout));
  }

  uniqueLock(const uniqueLock&) = delete;
  uniqueLock& operator=(const uniqueLock&) = delete;
};
} // namespace detail
} // namespace mvlib
