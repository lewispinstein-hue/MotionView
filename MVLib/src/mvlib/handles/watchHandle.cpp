#include "mvlib/watches.hpp"
#include "mvlib/core.hpp"

namespace mvlib {
bool WatchHandle::valid() const {
  return this->m_id != static_cast<WatchId>(-1);
}

bool WatchHandle::active() const {
  if (!this->valid()) return false;
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_watches.empty()) return false;

  const Logger::InternalWatch* watch = logger.m_findWatchUnlocked(this->m_id);
  return watch ? watch->active : false;
}

void WatchHandle::setActive(bool v) {
  if (!this->valid()) return;
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_watches.empty()) return;

  Logger::InternalWatch* watch = logger.m_findWatchUnlocked(this->m_id);
  if (!watch) return;
  watch->active = v;
}

uint32_t WatchHandle::intervalMs() const {
  if (!this->valid()) return static_cast<uint32_t>(-1);
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_watches.empty()) return static_cast<uint32_t>(-1);

  const Logger::InternalWatch* watch = logger.m_findWatchUnlocked(this->m_id);
  return watch ? watch->intervalMs : static_cast<uint32_t>(-1);
}

WatchMode WatchHandle::type() const {
  if (!this->valid()) return WatchMode::onInterval;
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_watches.empty()) return WatchMode::onInterval;

  const Logger::InternalWatch* watch = logger.m_findWatchUnlocked(this->m_id);
  if (!watch) return WatchMode::onInterval;
  
  return watch->onChange ? WatchMode::onChange : WatchMode::onInterval;
}

void WatchHandle::setIntervalMs(uint32_t intervalMs) {
  if (!this->valid()) return;
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_watches.empty()) return;

  Logger::InternalWatch* watch = logger.m_findWatchUnlocked(this->m_id);
  if (!watch) return;
  watch->intervalMs = intervalMs;
}

void WatchHandle::setType(WatchMode type) {
  if (!this->valid()) return;
  Logger& logger = Logger::getInstance();
  detail::uniqueLock lock(logger.m_mutex);
  if (!lock.isLocked() || logger.m_watches.empty()) return;

  Logger::InternalWatch* watch = logger.m_findWatchUnlocked(this->m_id);
  if (!watch) return;

  watch->onChange = type == WatchMode::onChange;
}

std::string WatchHandle::evaluate(bool emit) {
  if (!this->valid()) return {};
  return Logger::getInstance().evaluateWatch(this->m_id, emit);
}

bool WatchHandle::resyncRoster() const {
  if (!this->valid()) return false;
  return Logger::getInstance().resyncWatchRoster(this->m_id);
}
} // namespace mvlib
