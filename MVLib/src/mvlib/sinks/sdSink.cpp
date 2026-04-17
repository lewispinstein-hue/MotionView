#include "pros/misc.hpp"
#include "pros/rtos.hpp"
#include "mvlib/core.hpp"
#include "mvlib/private/forwardLogMacros.h"
#include <cstdarg>
#include <cstdint>
#include <cstring>
#include <random>

namespace mvlib {

uint32_t getrandInt(const uint32_t& min, const uint32_t& max) {
  /**
    * @note This method of generation is needed because the v5 brain is 
    *       completely deterministic. Using std::rand or std::random_device
    *       results in the same number every time.
  */

  uint64_t seed = pros::micros();
  seed ^= (uint64_t)pros::battery::get_voltage() << 32;
  seed ^= [&]() mutable -> uint64_t {
    seed += 0x9e3779b97f4a7c15ULL;
    uint64_t z = seed;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
  }();
  seed ^= std::chrono::system_clock::now().time_since_epoch().count();

  std::mt19937 gen(seed);
  std::uniform_int_distribution<> dis(min, max);
  return dis(gen);
}

std::string Logger::m_getTimestampedFile() {
  time_t now = time(0);
  tm *tstruct = localtime(&now);

  char filename[256]; // Increased size to accommodate folder + filename
  
  const uint32_t randInt = getrandInt(0, 99999);
  
  // Prepend /usd 
  char pathPrefix[64];
  snprintf(pathPrefix, sizeof(pathPrefix), "/usd%s", m_loggingFolder);

  if (tstruct->tm_year < 100) {
    _MVLIB_FORWARD_INFO("VEX RTC Inaccurate. Falling back to program duration.");
    
    snprintf(filename, sizeof(filename), "%s/MVLIB_%s_%u-%u_%d.log",
             pathPrefix, date, pros::millis() / 1000, pros::millis() / 100, randInt);
  } else {
    _MVLIB_FORWARD_INFO("VEX RTC Plausible. Creating file name with date.");
    
    char timeBuf[128];
    // Format the date/time string
    strftime(timeBuf, sizeof(timeBuf), "MVLIB_%Y-%m-%d_%H-%M", tstruct); 
    
    // Combine pathPrefix, formatted time, and random ID
    snprintf(filename, sizeof(filename), "%s/%s_%d.log", pathPrefix, timeBuf, randInt); 
  }
  
  return std::string(filename);
}

bool Logger::m_initSDLogger() {
  if (m_sdLocked) return false;

  if (pros::usd::is_installed()) {
    _MVLIB_FORWARD_DEBUG("SD Card installed (On first attempt)");
  } else {
    _MVLIB_FORWARD_DEBUG("SD Card not installed, rechecking...");
    for (int i = 0; i < 10; i++) {
      if (pros::usd::is_installed()) {
        _MVLIB_FORWARD_DEBUG("SD Card installed! Attempt: %d/10", i);
        break;
      }
      _MVLIB_FORWARD_DEBUG("Rechecking SD card installment... Attempts: %d/10", i);
      pros::delay(50);
    }
  }

  if (!pros::usd::is_installed()) {
    _MVLIB_FORWARD_FATAL("SD Card not installed after 10 attemps. Aborting SD card.");
    return false;
  }

  strncpy(m_currentFilename, m_getTimestampedFile().c_str(), sizeof(m_currentFilename) - 1);

  // Apply null terminator 
  m_currentFilename[sizeof(m_currentFilename) - 1] = '\0';

  m_sdFile = fopen(m_currentFilename, "w");
  if (!m_sdFile) {
    _MVLIB_FORWARD_FATAL("File: %s could not be opened. Aborting.", m_currentFilename);
    return false;
  }

  _MVLIB_FORWARD_DEBUG("File successfully opened.");
  fprintf(m_sdFile, "|———| Logger initialized at %.2fs |———|\n", pros::millis() / 1000.0);
  fflush(m_sdFile);
  return true;
}

bool Logger::setLoggingFolder(const char *folder, bool disableOnFail) {
  unique_lock lock(m_mutex);
  if (!lock.isLocked()) return false;
  if (m_started) return false;

  if (!folder || folder[0] == '\0' || folder[0] != '\\') {
    m_sdLocked = disableOnFail;
    return false;
  }

  std::string filenames{};
  filenames.resize(2048); // Dozens of log files should not cause memory overflow

  int err = pros::usd::list_files(folder, filenames.data(), filenames.size() - 1);
  if (err != 1) {
    if (err == ENOENT /* Cannot find path specified */) {
      _MVLIB_FORWARD_ERROR("setLoggingFolder failed. System could not find the "
        "path specified. Path: %s", folder);
    }
    m_sdLocked = disableOnFail;
    return false;
  }
  
  strncpy(m_loggingFolder, folder, sizeof(m_loggingFolder) - 1);
  m_loggingFolder[sizeof(m_loggingFolder) - 1] = '\0';
  return true;
}

void Logger::logToSD(const LogLevel& level, const char *fmt, ...) {
  if (!m_sdFile || m_sdLocked) return;

  unique_lock m(m_sdMutex);
  if (!m.isLocked()) return;
  
  uint32_t now = pros::millis();

  va_list args;
  va_start(args, fmt);
  vfprintf(m_sdFile, fmt, args);
  va_end(args);

  fprintf(m_sdFile, "\n");

  bool isError = (level == LogLevel::ERROR || level == LogLevel::FATAL);

  if (isError || (now - m_lastFileFlush >= m_timings.sdBufferFlushInterval)) {
    fflush(m_sdFile);
    m_lastFileFlush = now;
  }
}
} // namespace mvlib
