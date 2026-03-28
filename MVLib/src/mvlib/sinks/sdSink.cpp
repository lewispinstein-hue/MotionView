#include "pros/rtos.hpp"
#include "mvlib/core.hpp"
#include "mvlib/logMacros.h"
#include "mvlib/config.hpp"
#include <cstdarg>
#include <cstdint>
#include <cstring>
#include <sys/stat.h> 
#include <random>

#ifdef MVLIB_LOGS_REDEFINED
#undef LOG_DEBUG
#undef LOG_INFO
#undef LOG_WARN
#undef LOG_ERROR
#undef LOG_FATAL

#define LOG_DEBUG MVLIB_LOG_DEBUG
#define LOG_INFO MVLIB_LOG_INFO
#define LOG_WARN MVLIB_LOG_WARN
#define LOG_ERROR MVLIB_LOG_ERROR
#define LOG_FATAL MVLIB_LOG_FATAL
#endif

namespace mvlib {

int getrandInt(const uint32_t min, const uint32_t max) {
  /**
    * @note This method of generation is needed because the v5 brain is 
    *       completely deterministic. Using std::rand or std::random_device
    *       results in the same number every time.
  */

  uint64_t seed = pros::micros();
  seed ^= (uint64_t)pros::battery::get_voltage() << 32;
  seed &= [&]() -> uint64_t {
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

  static char filename[128];
  
  // Add random variance to filename to avoid overwriting existing files
  const int randInt = getrandInt(0, 99999);
  LOG_DEBUG("Got Random Int: %05u", randInt);

  if (tstruct->tm_year < 100) {
    LOG_INFO("VEX RTC Inaccurate. Falling back to program duration and last upload date.");
    // Use last upload and random number
    snprintf(filename, sizeof(filename), "/usd/MVLIB_%s_%u-%u_%05u.log",
             date, pros::millis() / 1000, pros::millis() / 100, randInt);
  } else {
    LOG_INFO("VEX RTC Plausible. Creating file name with date.");
    char timeBuf[64];
    strftime(timeBuf, sizeof(timeBuf),
             "/usd/MVLIB_%Y-%m-%d_%H-%M", tstruct); // Get time
    // Attach random number
    snprintf(filename, sizeof(filename), "%s_%05u.log", timeBuf, randInt); 
  }
  return filename;
} 

bool Logger::m_initSDLogger() {
  if (pros::usd::is_installed()) {
    LOG_DEBUG("SD Card installed (On first attempt)");
    pros::delay(500);
  } else {
    LOG_DEBUG("SD Card not installed, rechecking...");
    for (int i = 0; i < 10; i++) {
      if (pros::usd::is_installed()) {
        LOG_DEBUG("SD Card installed! Attempt: %d/10", i);
        break;
      }
      LOG_DEBUG("Rechecking SD card installment... Attempts: %d/10", i);
      pros::delay(200);
    }
  }

  if (!pros::usd::is_installed()) {
    LOG_FATAL("SD Card not installed after 10 attemps. Aborting SD card.");
    return false;
  }

  strncpy(m_currentFilename, m_getTimestampedFile().c_str(), sizeof(m_currentFilename) - 1);

  // Apply null terminator 
  m_currentFilename[sizeof(m_currentFilename) - 1] = '\0';

  m_sdFile = fopen(m_currentFilename, "w");
  if (!m_sdFile) {
    LOG_FATAL("File: %s could not be opened. Aborting.", m_currentFilename);
    return false;
  }
  LOG_DEBUG("File successfully opened.");
  fprintf(m_sdFile, "|———| Logger initialized at %.2fs |———|\n", pros::millis() / 1000.0);
  fflush(m_sdFile);
  return true;
}

void Logger::logToSD(const char *levelStr, const char *fmt, ...) {
  if (!m_sdFile || m_sdLocked) return;

  unique_lock m(m_sdCardMutex);
  if (!m.isLocked()) return;
  uint32_t now = pros::millis();

  fprintf(m_sdFile, "[%.2f] [%s]: ", now / 1000.0, levelStr);

  va_list args;
  va_start(args, fmt);
  vfprintf(m_sdFile, fmt, args);
  va_end(args);

  fprintf(m_sdFile, "\n");

  bool isError = (strcmp(levelStr, "ERROR") == 0 || strcmp(levelStr, "FATAL") == 0);

  if (isError || (now - m_lastFileFlush >= SD_FLUSH_INTERVAL_MS)) {
    fflush(m_sdFile);
    m_lastFileFlush = now;
  }
}

}
