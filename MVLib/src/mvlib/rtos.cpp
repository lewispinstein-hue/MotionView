#include "mvlib/core.hpp"

namespace mvlib {
uint32_t Logger::status() const {
  if (!m_task)
    return pros::E_TASK_STATE_INVALID;
  return m_task->get_state();
}

void Logger::pause() {
  uint32_t st = status();
  bool isPauseable = st != pros::E_TASK_STATE_DELETED &&
                     st != pros::E_TASK_STATE_INVALID &&
                     st != pros::E_TASK_STATE_SUSPENDED;

  if (isPauseable) {
    m_pauseRequested.store(true);
    logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
               "pause() Logger paused.");

  } else {
    logMessage(
        LogLevel::DEBUG, detail::LogSource::SYSTEM,
        "pause() Logger cannot be paused as it is not in a running state.");
  }
}

void Logger::resume() {
  uint32_t st = status();
  bool wasPaused = false;

  if (m_pauseRequested.exchange(false))
    wasPaused = true;

  if (st != pros::E_TASK_STATE_DELETED && st != pros::E_TASK_STATE_INVALID &&
      st == pros::E_TASK_STATE_SUSPENDED) {
    m_task->resume();
    wasPaused = true;
  }

  if (wasPaused) {
    logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
               "resume() Logger resumed.");

  } else {
    logMessage(LogLevel::DEBUG, detail::LogSource::SYSTEM,
               "resume() Logger cannot be resumed as it is not paused.");
  }
}
} // namespace mvlib
