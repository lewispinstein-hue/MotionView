#include "mvlib/watches.hpp"
#include "mvlib/core.hpp"
#include "mvlib/private/telemetry.hpp"
#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdlib>

namespace mvlib {
Logger::InternalWatch* Logger::m_findWatchUnlocked(WatchId id) {
  auto it = std::find_if(m_watches.begin(), m_watches.end(),
                         [id](const InternalWatch& watch) { return watch.id == id; });
  return (it == m_watches.end()) ? nullptr : &(*it);
}

const Logger::InternalWatch* Logger::m_findWatchUnlocked(WatchId id) const {
  auto it = std::find_if(m_watches.begin(), m_watches.end(),
                         [id](const InternalWatch& watch) { return watch.id == id; });
  return (it == m_watches.end()) ? nullptr : &(*it);
}

std::optional<std::string> Logger::m_getWatchNameUnlocked(WatchId id, bool isElevated) const {
  const InternalWatch* watch = m_findWatchUnlocked(id);
  if (!watch) return std::nullopt;

  if (isElevated && !watch->elevatedLabel.empty()) return watch->elevatedLabel;
  else return watch->label;
}

void Logger::resyncAllWatchesRoster() {
  detail::uniqueLock lock(m_mutex);
  if (!lock.isLocked()) return;
  if (m_watches.empty() || !m_config.logToTerminal.load()) return;

  for (const auto& watch : m_watches) {
    detail::Telemetry::getInstance().sendRoster(watch.id, watch.label, false);
    if (!watch.elevatedLabel.empty()) {
      detail::Telemetry::getInstance().sendRoster(watch.id, watch.elevatedLabel, true);
    }
  }
  m_lastRosterFlush = pros::millis();
}

bool Logger::resyncWatchRoster(WatchId id) {
  detail::uniqueLock lock(m_mutex);
  if (!lock.isLocked()) return false;
  if (m_watches.empty() || !m_config.logToTerminal.load()) return false;

  InternalWatch* watch = m_findWatchUnlocked(id);
  if (!watch || !watch->active) return false;

  detail::Telemetry::getInstance().sendRoster(watch->id, watch->label, false);
  if (!watch->elevatedLabel.empty()) {
    detail::Telemetry::getInstance().sendRoster(watch->id, watch->elevatedLabel, true);
  }
  m_lastRosterFlush = pros::millis();
  return true;
}

std::string Logger::evaluateWatch(WatchId id, bool emit) {
  LogLevel lvl{};
  std::string valueStr{};
  std::string label{};
  bool tripped = false;
  uint32_t nowMs = 0;
  std::shared_ptr<std::function<std::tuple<LogLevel, std::string, std::string, bool>()>> eval;
  std::shared_ptr<pros::Mutex> evalMutex;

  {
    // Manual watch evaluation intentionally invokes the stored evaluator directly
    // so stateful watch closures keep their internal transition/debounce state.
    detail::uniqueLock lock(m_mutex);
    if (!lock.isLocked()) return {};
    if (m_watches.empty()) return {};

    InternalWatch* watch = m_findWatchUnlocked(id);
    if (!watch || !watch->eval || !watch->evalMutex) return {};
    eval = watch->eval;
    evalMutex = watch->evalMutex;
  }

  detail::uniqueLock callbackLock(*evalMutex, TIMEOUT_MAX);
  if (!callbackLock.isLocked()) return {};

  std::tie(lvl, valueStr, label, tripped) = (*eval)();
  if (!emit) return valueStr;

  nowMs = pros::millis();

  if (m_config.logToTerminal.load()) {
    bool sentAsBinary = false;

    if (!valueStr.empty()) {
      char* end = nullptr;
      errno = 0;
      const float numericVal = std::strtof(valueStr.c_str(), &end);
      if (end != valueStr.c_str() && end != nullptr && *end == '\0' &&
          errno != ERANGE && std::isfinite(numericVal)) {
        detail::Telemetry::getInstance().sendWatch(id, lvl, numericVal, tripped);
        sentAsBinary = true;
      }
    }

    if (!sentAsBinary) {
      detail::Telemetry::getInstance().sendWatchText(id, lvl, valueStr, tripped);
    }
  }

  if (m_config.logToSD.load() && !m_sdLocked && m_sdFile) {
    if (valueStr == "f") valueStr = "false";
    if (valueStr == "t") valueStr = "true";

    logToSD(lvl, "[WATCH],%u,%s,%u,%s,%s", nowMs,
            levelToString(lvl), id, label.c_str(), valueStr.c_str());
  }

  return valueStr;
}
} // namespace mvlib
