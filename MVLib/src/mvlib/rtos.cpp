#include "mvlib/core.hpp"
#define _MVLIB_PREVENT_MACRO_CLEANUP
#include "mvlib/private/forwardLogMacros.h"

namespace mvlib {
uint32_t Logger::status() const {
  if (!m_task) return pros::E_TASK_STATE_INVALID;
  return m_task->get_state();
}

void Logger::pause() {
  uint32_t st = status();
  bool isPauseable =
    st != pros::E_TASK_STATE_DELETED && 
    st != pros::E_TASK_STATE_INVALID &&
    st != pros::E_TASK_STATE_SUSPENDED;

  if (isPauseable) {
    m_pauseRequested.store(true);
    _MVLIB_FORWARD_DEBUG("pause() Logger paused.");
  } else {
    _MVLIB_FORWARD_DEBUG("pause() Logger cannot be paused as it is not in a running state.");
  }
}

void Logger::resume() {
  uint32_t st = status();
  bool wasPaused = false;

  if (m_pauseRequested.exchange(false)) wasPaused = true;

  if (st != pros::E_TASK_STATE_DELETED && 
      st != pros::E_TASK_STATE_INVALID && 
      st == pros::E_TASK_STATE_SUSPENDED) {
    m_task->resume();
    wasPaused = true;
  }

  if (wasPaused) {
    _MVLIB_FORWARD_DEBUG("resume() Logger resumed.");
  } else {
    _MVLIB_FORWARD_DEBUG("resume() Logger cannot be resumed as it is not paused.");
  }
}
} // namespace mvlib
